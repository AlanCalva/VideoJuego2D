/* =========================================================
   Breakout WebGL 2D — niveles, partículas y colisiones
   - Puntos por nivel + total
   - Overlay "¡Perdido!" con Avanzar / Reiniciar
   - Nivel 5: 3 pelotitas (2 extra auto-lanzadas)
   - Velocidad escala por nivel
   - Título grande "Nivel X" (levelTitle)
   ========================================================= */

const YEAR_EL = document.getElementById('year');
if (YEAR_EL) YEAR_EL.textContent = new Date().getFullYear();

const canvas = document.getElementById('glcanvas');
/** @type {WebGLRenderingContext} */
const gl = canvas.getContext('webgl', { antialias: true, alpha: false });
if (!gl) { alert('Tu navegador no soporta WebGL'); throw new Error('No WebGL'); }

/* ---------- Shaders ---------- */
const VS = `
attribute vec2 a_pos;
uniform vec2 u_resolution;
uniform vec2 u_translate;
uniform vec2 u_scale;
uniform float u_rotation;
void main(){
  float c = cos(u_rotation), s = sin(u_rotation);
  vec2 pr = vec2(a_pos.x*c - a_pos.y*s, a_pos.x*s + a_pos.y*c);
  vec2 px = pr * u_scale + u_translate;
  vec2 zeroOne = px / u_resolution;
  vec2 clip = zeroOne * 2.0 - 1.0;
  gl_Position = vec4(clip * vec2(1.0,-1.0), 0.0, 1.0);
}
`;
const FS = `
precision mediump float;
uniform vec4 u_color;
void main(){ gl_FragColor = u_color; }
`;
function compileShader(type, src){
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src); gl.compileShader(sh);
  if(!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
  return sh;
}
const prog = gl.createProgram();
gl.attachShader(prog, compileShader(gl.VERTEX_SHADER, VS));
gl.attachShader(prog, compileShader(gl.FRAGMENT_SHADER, FS));
gl.linkProgram(prog);
if(!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
gl.useProgram(prog);

/* ---------- Atributos / Uniforms ---------- */
const a_pos = gl.getAttribLocation(prog, 'a_pos');
const u_resolution = gl.getUniformLocation(prog, 'u_resolution');
const u_translate  = gl.getUniformLocation(prog, 'u_translate');
const u_scale      = gl.getUniformLocation(prog, 'u_scale');
const u_rotation   = gl.getUniformLocation(prog, 'u_rotation');
const u_color      = gl.getUniformLocation(prog, 'u_color');

/* ---------- Geometría base ---------- */
const quad = new Float32Array([
  -0.5,-0.5,  0.5,-0.5,  -0.5, 0.5,
  -0.5, 0.5,  0.5,-0.5,   0.5, 0.5
]);
const vbo = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
gl.enableVertexAttribArray(a_pos);
gl.vertexAttribPointer(a_pos, 2, gl.FLOAT, false, 0, 0);

/* ---------- HUD & overlays ---------- */
const HUD = {
  score: document.getElementById('score'),
  lives: document.getElementById('lives'),
  level: document.getElementById('level'),
  levelScore: document.getElementById('levelScore')
};
const levelTitle = document.getElementById('levelTitle');
const overlayWin  = document.getElementById('overlayMsg');
const overlayLose = document.getElementById('overlayLose');
const loseTitle   = document.getElementById('loseTitle');
const loseInfo    = document.getElementById('loseInfo');
const btnNext     = document.getElementById('btnNext');
const btnRetry    = document.getElementById('btnRetry');

/* ---------- Estado ---------- */
let totalScore = 0; // total
let levelScore = 0; // por nivel
let lives = 3;
let level = 1;

const WORLD = { w: canvas.width, h: canvas.height };
function resize(){
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width|0;
  canvas.height = rect.height|0;
  WORLD.w = canvas.width; WORLD.h = canvas.height;
  gl.viewport(0,0,gl.drawingBufferWidth, gl.drawingBufferHeight);
  gl.uniform2f(u_resolution, canvas.width, canvas.height);
}
resize();
window.addEventListener('resize', resize);

gl.enable(gl.BLEND);
gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

/* ---------- Dibujo rect ---------- */
function rect(x,y,w,h, color, rot=0){
  gl.uniform2f(u_translate, x + w/2, y + h/2);
  gl.uniform2f(u_scale, w, h);
  gl.uniform1f(u_rotation, rot);
  gl.uniform4f(u_color, color[0],color[1],color[2],color[3]);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
}

/* ---------- Paleta ---------- */
const C = {
  bgTop:  [0.06,0.13,0.24,1],
  bgBot:  [0.03,0.07,0.13,1],
  vign:   [0,0,0,0.16],
  paddle: [0.33,0.85,0.62,1],
  ball:   [0.96,0.96,1.0,1],
  brick1: [0.99,0.36,0.30,1],
  brick2: [0.98,0.59,0.25,1],
  brick3: [0.95,0.81,0.31,1],
  brick4: [0.33,0.70,0.97,1],
  flash:  [1,1,1,0.25],
  partA:  [1,0.83,0.42,1],
  partB:  [0.9,0.4,1,1]
};

/* ---------- Entidades ---------- */
const paddle = { w: 120, h: 16, x: WORLD.w/2 - 60, y: WORLD.h - 60, speed: 560 };
/** @typedef {{x:number,y:number,vx:number,vy:number,r:number,launched:boolean}} Ball */
let balls = [];
let bricks = [];
const particles = [];

/* ---------- Velocidad por nivel ---------- */
/* 1.0, 1.2, 1.4, 1.6, 1.8 … */
function speedFactorForLevel(n){ return 1 + (n-1)*0.20; }

/* ---------- Niveles ---------- */
function generateLevel(n){
  // Oculta overlays
  if (overlayLose) { overlayLose.classList.remove('show'); overlayLose.classList.add('hidden'); }
  if (overlayWin)  { overlayWin.classList.remove('show');  overlayWin.classList.add('hidden');  }

  // Título de nivel
  if (levelTitle) levelTitle.textContent = `Nivel ${n}`;

  levelScore = 0; // reset puntos de este nivel

  const count = Math.min(10 + (n-1)*5, 30);
  bricks = [];
  const margin = 40;
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const gridW = WORLD.w - margin*2;
  const bw = Math.max(50, Math.floor(gridW / cols) - 10);
  const bh = 22;

  const xoff = (n % 2 === 0) ? 0 : 0.5;
  const yoff = (n % 3 === 0) ? 0.5 : 0;

  let placed = 0;
  for(let r=0;r<rows;r++){
    for(let c=0;c<cols;c++){
      if(placed>=count) break;
      const x = margin + c*(bw+10) + ((c%2)? xoff*12 : 0);
      const y = margin + r*(bh+10) + ((r%2)? yoff*12 : 0);
      const color = [C.brick1,C.brick2,C.brick3,C.brick4][(r+c)%4];
      bricks.push({x,y,w:bw,h:bh,hp:1,color});
      placed++;
    }
  }

  // bolas: nivel 5 = 3 pelotitas (2 extra auto-lanzadas y separadas)
  balls = [];
  balls.push(makeBall(n)); // principal queda pegada a la paleta hasta lanzar

  if(n === 5){
    const k = speedFactorForLevel(n);

    const b2 = makeBall(n);
    const b3 = makeBall(n);

    // posiciones distintas
    b2.x = WORLD.w/2 - 30; b2.y = paddle.y - 18;
    b3.x = WORLD.w/2 + 30; b3.y = paddle.y - 18;

    // se lanzan para que NO se peguen y se vean desde el inicio
    b2.launched = true;
    b3.launched = true;

    // velocidades iniciales diferentes para separarlas
    b2.vx = -260 * k;  b2.vy = -300 * k;
    b3.vx =  260 * k;  b3.vy = -300 * k;

    balls.push(b2, b3);
  }
}

function makeBall(levelNum){
  const k = speedFactorForLevel(levelNum);
  const baseVX = 240, baseVY = -280;
  return {
    x: WORLD.w/2,
    y: paddle.y - 18,
    vx: (baseVX * (Math.random()<0.5?-1:1)) * k,
    vy: (baseVY) * k,
    r: 8,
    launched: false
  };
}

/* ---------- Partículas ---------- */
function addParticle(x,y,vx,vy,life,size,color,rot=0){
  particles.push({x,y,vx,vy,life,max:life,size,color,rot});
}
function burst(x,y, baseCol){
  for(let i=0;i<26;i++){
    const a = Math.random()*Math.PI*2;
    const sp = 100 + Math.random()*240;
    const vx = Math.cos(a)*sp*0.01;
    const vy = Math.sin(a)*sp*0.01;
    const size = 2 + Math.random()*4;
    const life = .55 + Math.random()*.6;
    const col = (Math.random()<.5? C.partA : C.partB);
    const mix = [
      (col[0]+baseCol[0])*0.5,
      (col[1]+baseCol[1])*0.5,
      (col[2]+baseCol[2])*0.5,
      1
    ];
    addParticle(x,y,vx,vy,life,size,mix, Math.random()*6.28);
  }
  addParticle(x,y,0,0,.15, 46, C.flash, 0);
}

/* ---------- Entrada ---------- */
const keys = {};
document.addEventListener('keydown', e=>{
  keys[e.code]=true;
  if(e.code==='Space'){ e.preventDefault(); balls.forEach(b=> b.launched = true); }
  else if(e.code==='KeyR'){ e.preventDefault(); resetGame(true); }
});
document.addEventListener('keyup', e=> keys[e.code]=false);
canvas.addEventListener('click', ()=> balls.forEach(b=> b.launched=true));

/* ---------- Overlays ---------- */
function showWinOverlay(text='¡Nivel Completado!'){
  if(!overlayWin) return;
  overlayWin.textContent = text;
  overlayWin.classList.remove('hidden');
  void overlayWin.offsetWidth;           // fuerza reflujo
  overlayWin.classList.add('show');
  setTimeout(()=>{
    overlayWin.classList.remove('show');
    setTimeout(()=> overlayWin.classList.add('hidden'), 200);
  }, 900);
}

function showLoseOverlay(){
  if(!overlayLose) return;
  loseTitle.textContent = '¡Perdido!';
  loseInfo.textContent = `Nivel ${level} — Puntos nivel: ${levelScore} — Total: ${totalScore} — Vidas: ${lives}`;
  overlayLose.classList.remove('hidden');
  void overlayLose.offsetWidth;          // fuerza reflujo
  overlayLose.classList.add('show');
}
function hideLoseOverlay(){
  if(!overlayLose) return;
  overlayLose.classList.remove('show');
  setTimeout(()=> overlayLose.classList.add('hidden'), 180);
}

// Botones del overlay de pérdida
if (btnNext){
  btnNext.onclick = ()=>{
    hideLoseOverlay();
    if (lives <= 0) resetGame(true); // si ya no hay vidas, reinicio total
    else nextLevel();                // si hay vidas, avanza de nivel
  };
}
if (btnRetry){
  btnRetry.onclick = ()=>{
    hideLoseOverlay();
    generateLevel(level);            // reinicia el mismo nivel
  };
}

/* ---------- Lógica ---------- */
function update(dt){
  // paleta
  let vx = 0; if(keys['ArrowLeft']) vx -= 1; if(keys['ArrowRight']) vx += 1;
  paddle.x += vx * paddle.speed * dt;
  paddle.x = Math.max(0, Math.min(WORLD.w - paddle.w, paddle.x));

  // pelotas
  for(const b of balls){
    if(!b.launched){ b.x = paddle.x + paddle.w/2; b.y = paddle.y - 18; continue; }
    b.x += b.vx * dt; b.y += b.vy * dt;

    // bordes
    if(b.x - b.r < 0){ b.x = b.r; b.vx *= -1; }
    if(b.x + b.r > WORLD.w){ b.x = WORLD.w - b.r; b.vx *= -1; }
    if(b.y - b.r < 0){ b.y = b.r; b.vy *= -1; }

    // cayó
    if(b.y - b.r > WORLD.h){
      const stillIn = balls.filter(bb => (bb.y - bb.r) <= WORLD.h);
      if(stillIn.length===0){
        lives--;
        balls = [ makeBall(level) ];  // reaparece una ligada a paleta
        showLoseOverlay();            // muestra opciones
      }
    }

    // paleta
    if(circleRect(b.x,b.y,b.r, paddle.x,paddle.y,paddle.w,paddle.h)){
      b.y = paddle.y - b.r - 0.1;
      b.vy = -Math.abs(b.vy);
      const hit = (b.x - (paddle.x + paddle.w/2)) / (paddle.w/2);
      const k = speedFactorForLevel(level);
      b.vx = hit * 330 * k;
      b.vy = -Math.max(230 * k, Math.abs(b.vy));
    }

    // bloques
    for(let i=bricks.length-1;i>=0;i--){
      const br = bricks[i];
      if(aabb(b.x-b.r,b.y-b.r,b.r*2,b.r*2, br.x,br.y,br.w,br.h)){
        const overlapX = (br.x + br.w/2) - b.x;
        const overlapY = (br.y + br.h/2) - b.y;
        if(Math.abs(overlapX) > Math.abs(overlapY)){ b.vx = (overlapX>0)? -Math.abs(b.vx): Math.abs(b.vx); }
        else{ b.vy = (overlapY>0)? -Math.abs(b.vy): Math.abs(b.vy); }

        // romper + puntuar
        bricks.splice(i,1);
        totalScore += 10;
        levelScore += 10;
        burst(b.x, b.y, br.color);

        if(bricks.length===0){
          nextLevel();
          return;
        }
      }
    }
  }

  // partículas
  for(let i=particles.length-1;i>=0;i--){
    const p = particles[i];
    p.x += p.vx; p.y += p.vy; p.vx *= 0.99; p.vy *= 0.99; p.life -= dt;
    if(p.life <= 0) particles.splice(i,1);
  }

  // HUD + título
  if(HUD.score)      HUD.score.textContent = `Puntos: ${totalScore}`;
  if(HUD.levelScore) HUD.levelScore.textContent = `Puntos Nivel: ${levelScore}`;
  if(HUD.lives)      HUD.lives.textContent = `Vidas: ${lives}`;
  if(HUD.level)      HUD.level.textContent = `Nivel: ${level}`;
  if(levelTitle)     levelTitle.textContent = `Nivel ${level}`;
}

/* ---------- Render ---------- */
function drawBackground(){
  gl.clearColor(C.bgBot[0],C.bgBot[1],C.bgBot[2],1); gl.clear(gl.COLOR_BUFFER_BIT);
  rect(0,0, WORLD.w, WORLD.h*0.5, [C.bgTop[0],C.bgTop[1],C.bgTop[2],0.55]);
  const v = C.vign;
  rect(-40,0,40,WORLD.h,v); rect(WORLD.w,0,40,WORLD.h,v);
  rect(0,-40,WORLD.w,40,v); rect(0,WORLD.h,WORLD.w,60,v);
}
function render(){
  drawBackground();
  rect(paddle.x, paddle.y, paddle.w, paddle.h, C.paddle);
  for(const br of bricks){ rect(br.x, br.y, br.w, br.h, br.color); rect(br.x, br.y, br.w, 3, [1,1,1,0.14]); }
  for(const b of balls){ rect(b.x - b.r, b.y - b.r, b.r*2, b.r*2, C.ball); }
  for(const p of particles){
    const a = Math.max(0, p.life / p.max);
    rect(p.x - p.size/2, p.y - p.size/2, p.size, p.size, [p.color[0],p.color[1],p.color[2], a], p.rot);
  }
}

/* ---------- Colisiones ---------- */
function aabb(ax,ay,aw,ah, bx,by,bw,bh){
  return ax < bx+bw && ax+aw > bx && ay < by+bh && ay+ah > by;
}
function circleRect(cx,cy,cr, rx,ry,rw,rh){
  const nx = Math.max(rx, Math.min(cx, rx+rw));
  const ny = Math.max(ry, Math.min(cy, ry+rh));
  const dx = cx - nx, dy = cy - ny;
  return (dx*dx + dy*dy) <= cr*cr;
}

/* ---------- Flujo ---------- */
function resetGame(hard=false){
  hideLoseOverlay();
  if(hard){ totalScore=0; level=1; lives=3; }
  else{ level=1; lives=3; }
  generateLevel(level);
}
function nextLevel(){
  hideLoseOverlay();
  level++;
  if(level>5){ level=1; } // si prefieres final, cámbialo aquí
  showWinOverlay('¡Nivel Completado!');
  generateLevel(level);
}

/* ---------- Bucle ---------- */
let last = 0;
function loop(ts){
  const t = ts*0.001;
  const dt = Math.min(0.032, t - last || 0.016);
  last = t;
  update(dt);
  render();
  requestAnimationFrame(loop);
}

/* ---------- Inicio ---------- */
generateLevel(level);
requestAnimationFrame(loop);
