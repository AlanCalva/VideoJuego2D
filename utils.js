// Utilidades simples
function loadShader(gl, type, source){
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if(!gl.getShaderParameter(shader, gl.COMPILE_STATUS)){
    throw new Error('Error compilando shader: ' + gl.getShaderInfoLog(shader));
  }
  return shader;
}

function createProgram(gl, vsSource, fsSource){
  const vs = loadShader(gl, gl.VERTEX_SHADER, vsSource);
  const fs = loadShader(gl, gl.FRAGMENT_SHADER, fsSource);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if(!gl.getProgramParameter(prog, gl.LINK_STATUS)){
    throw new Error('Error linkeando programa: ' + gl.getProgramInfoLog(prog));
  }
  return prog;
}

function clamp(x, a, b){ return Math.max(a, Math.min(b, x)); }
