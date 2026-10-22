/*
 * Animated topographic background.
 *
 * Ported to plain JavaScript from the Animate UI "Topography Background"
 * component (MIT License, https://animate-ui.com), as listed on 21st.dev.
 * The noise, WebGL shader, Canvas 2D fallback, spring settings and timings
 * follow the original; the React and Motion hooks are replaced by the small
 * spring and easing helpers below.
 *
 * - Contour lines drift slowly over time (3D Perlin noise, z = time).
 * - A hill rises under the pointer and follows it on a spring.
 * - A click or tap sends a ripple across the map.
 * - Lines take the CSS color of .topo-bg, so they follow the light/dark theme.
 * - With reduced motion it draws one still frame; it pauses while the tab is hidden.
 */
(function () {
  'use strict';

  var container = document.querySelector('[data-topography]');
  if (!container) return;
  var canvas = container.querySelector('canvas');
  if (!canvas) return;

  var CELL = 10;
  var RELAX = 2;
  var MIN_FRAME = 10;
  var FEATURE = 280;
  var RANGE = 0.95;
  var HILL_RADIUS = 90;
  var RIPPLE_WIDTH = 60;

  // Settings for this site (the original component's props).
  var LEVELS = 20;
  var SPEED = 1;
  var SCALE = 1;
  var PEAK = 1;

  /* ------------------------------------------------------------ noise */

  var PERMUTATION = (function () {
    var table = [];
    for (var i = 0; i < 256; i += 1) table.push(i);
    var seed = 1013;
    for (var k = 255; k > 0; k -= 1) {
      seed = (seed * 16807) % 2147483647;
      var j = seed % (k + 1);
      var t = table[k];
      table[k] = table[j];
      table[j] = t;
    }
    return Uint8Array.from(table.concat(table));
  })();

  function fade(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function grad(hash, x, y, z) {
    var h = hash & 15;
    var u = h < 8 ? x : y;
    var v = h < 4 ? y : h === 12 || h === 14 ? x : z;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  }

  function noise(x, y, z) {
    var p = PERMUTATION;
    var X = Math.floor(x) & 255;
    var Y = Math.floor(y) & 255;
    var Z = Math.floor(z) & 255;
    x -= Math.floor(x);
    y -= Math.floor(y);
    z -= Math.floor(z);
    var u = fade(x);
    var v = fade(y);
    var w = fade(z);
    var A = p[X] + Y;
    var AA = p[A] + Z;
    var AB = p[A + 1] + Z;
    var B = p[X + 1] + Y;
    var BA = p[B] + Z;
    var BB = p[B + 1] + Z;
    return lerp(
      lerp(
        lerp(grad(p[AA], x, y, z), grad(p[BA], x - 1, y, z), u),
        lerp(grad(p[AB], x, y - 1, z), grad(p[BB], x - 1, y - 1, z), u),
        v
      ),
      lerp(
        lerp(grad(p[AA + 1], x, y, z - 1), grad(p[BA + 1], x - 1, y, z - 1), u),
        lerp(grad(p[AB + 1], x, y - 1, z - 1), grad(p[BB + 1], x - 1, y - 1, z - 1), u),
        v
      ),
      w
    );
  }

  /* ------------------------------------------------------------ motion helpers */

  /** A damped spring (unit mass) like Motion's useSpring. */
  function Spring(value, stiffness, damping) {
    this.value = value;
    this.target = value;
    this.velocity = 0;
    this.k = stiffness;
    this.c = damping;
  }
  Spring.prototype.step = function (dt) {
    // Small fixed sub-steps keep the integration stable at any frame rate.
    var steps = Math.max(1, Math.ceil(dt / 0.008));
    var h = dt / steps;
    for (var i = 0; i < steps; i += 1) {
      var force = this.k * (this.target - this.value) - this.c * this.velocity;
      this.velocity += force * h;
      this.value += this.velocity * h;
    }
  };
  Spring.prototype.jump = function (value) {
    this.value = value;
    this.target = value;
    this.velocity = 0;
  };
  Spring.prototype.settled = function () {
    return Math.abs(this.target - this.value) < 0.001 && Math.abs(this.velocity) < 0.001;
  };

  /** CSS-style cubic-bezier easing (x1, y1, x2, y2). */
  function cubicBezier(x1, y1, x2, y2) {
    function at(a1, a2, t) {
      return ((1 - 3 * a2 + 3 * a1) * t + (3 * a2 - 6 * a1)) * t * t + 3 * a1 * t;
    }
    function slope(a1, a2, t) {
      return 3 * (1 - 3 * a2 + 3 * a1) * t * t + 2 * (3 * a2 - 6 * a1) * t + 3 * a1;
    }
    return function (x) {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      var t = x;
      for (var i = 0; i < 8; i += 1) {
        var d = slope(x1, x2, t);
        if (Math.abs(d) < 1e-6) break;
        t -= (at(x1, x2, t) - x) / d;
      }
      return at(y1, y2, Math.min(1, Math.max(0, t)));
    };
  }

  var riseEase = cubicBezier(0.16, 1, 0.3, 1);
  var rippleEase = cubicBezier(0.25, 0.4, 0.45, 1);

  /* ------------------------------------------------------------ WebGL renderer */

  var VERTEX = [
    'attribute vec2 position;',
    'void main() {',
    '  gl_Position = vec4(position, 0.0, 1.0);',
    '}',
  ].join('\n');

  var FRAGMENT = [
    '#extension GL_OES_standard_derivatives : enable',
    'precision highp float;',
    'uniform sampler2D permutation;',
    'uniform vec2 size;',
    'uniform float dpr;',
    'uniform float feature;',
    'uniform float z;',
    'uniform float step;',
    'uniform float range;',
    'uniform float amount;',
    'uniform float lift;',
    'uniform float hillRadius;',
    'uniform vec2 hill;',
    'uniform vec4 ripples[4];',
    'uniform float reach;',
    'uniform float rippleWidth;',
    'uniform vec3 color;',
    'float perm(float i) {',
    '  return floor(texture2D(permutation, vec2((mod(i, 256.0) + 0.5) / 256.0, 0.5)).r * 255.0 + 0.5);',
    '}',
    'float fade(float t) {',
    '  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);',
    '}',
    'float grad(float hash, float x, float y, float z) {',
    '  float h = mod(hash, 16.0);',
    '  float u = h < 8.0 ? x : y;',
    '  float v = h < 4.0 ? y : (h == 12.0 || h == 14.0 ? x : z);',
    '  return (mod(h, 2.0) == 0.0 ? u : -u) + (mod(floor(h / 2.0), 2.0) == 0.0 ? v : -v);',
    '}',
    'float noise(vec3 p) {',
    '  vec3 cell = mod(floor(p), 256.0);',
    '  vec3 f = p - floor(p);',
    '  float u = fade(f.x);',
    '  float v = fade(f.y);',
    '  float w = fade(f.z);',
    '  float A = perm(cell.x) + cell.y;',
    '  float AA = perm(A) + cell.z;',
    '  float AB = perm(A + 1.0) + cell.z;',
    '  float B = perm(cell.x + 1.0) + cell.y;',
    '  float BA = perm(B) + cell.z;',
    '  float BB = perm(B + 1.0) + cell.z;',
    '  return mix(',
    '    mix(',
    '      mix(grad(perm(AA), f.x, f.y, f.z), grad(perm(BA), f.x - 1.0, f.y, f.z), u),',
    '      mix(grad(perm(AB), f.x, f.y - 1.0, f.z), grad(perm(BB), f.x - 1.0, f.y - 1.0, f.z), u),',
    '      v',
    '    ),',
    '    mix(',
    '      mix(grad(perm(AA + 1.0), f.x, f.y, f.z - 1.0), grad(perm(BA + 1.0), f.x - 1.0, f.y, f.z - 1.0), u),',
    '      mix(grad(perm(AB + 1.0), f.x, f.y - 1.0, f.z - 1.0), grad(perm(BB + 1.0), f.x - 1.0, f.y - 1.0, f.z - 1.0), u),',
    '      v',
    '    ),',
    '    w',
    '  );',
    '}',
    'void main() {',
    '  vec2 point = vec2(gl_FragCoord.x, size.y - gl_FragCoord.y) / dpr;',
    '  vec2 n = point / feature;',
    '  float value = noise(vec3(n, z)) * 1.1 + noise(vec3(n * 2.1, z * 1.7)) * 0.45;',
    '  if (lift > 0.0) value += lift * exp(-length(point - hill) / hillRadius);',
    '  for (int i = 0; i < 4; i++) {',
    '    vec4 ripple = ripples[i];',
    '    if (ripple.w > 0.5) {',
    '      float d = length(point - ripple.xy) - ripple.z * reach;',
    '      value += 0.9 * (1.0 - ripple.z) * cos(d / rippleWidth * 1.8) * exp(-(d * d) / (2.0 * rippleWidth * rippleWidth));',
    '    }',
    '  }',
    '  value *= amount;',
    '  float level = (value + range) / step;',
    '  float nearest = floor(level + 0.5);',
    '  float slope = length(vec2(dFdx(level), dFdy(level)));',
    '  float pixels = abs(level - nearest) / max(slope, 1e-6);',
    '  bool major = mod(nearest, 5.0) == 0.0;',
    '  float width = (major ? 1.5 : 1.0) * dpr;',
    '  float alpha = slope > 1e-6 ? clamp(width * 0.5 + 0.5 - pixels, 0.0, 1.0) * (major ? 0.85 : 0.4) : 0.0;',
    '  gl_FragColor = vec4(color * alpha, alpha);',
    '}',
  ].join('\n');

  function compile(gl, type, source) {
    var shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
  }

  function createGlRenderer(gl) {
    if (!gl.getExtension('OES_standard_derivatives')) return null;
    var vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
    var fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    var program = gl.createProgram();
    if (!vertex || !fragment || !program) return null;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
    gl.useProgram(program);

    var buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var position = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    var texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 256, 1, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, PERMUTATION.subarray(0, 256));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    var u = {};
    ['permutation', 'size', 'dpr', 'feature', 'z', 'step', 'range', 'amount', 'lift', 'hillRadius', 'hill', 'ripples', 'reach', 'rippleWidth', 'color']
      .forEach(function (name) { u[name] = gl.getUniformLocation(program, name); });
    gl.uniform1i(u.permutation, 0);
    gl.uniform1f(u.range, RANGE);
    gl.uniform1f(u.hillRadius, HILL_RADIUS);
    gl.uniform1f(u.rippleWidth, RIPPLE_WIDTH);

    return function (f) {
      var w = Math.max(1, Math.round(f.width * f.dpr));
      var h = Math.max(1, Math.round(f.height * f.dpr));
      gl.viewport(0, 0, w, h);
      gl.uniform2f(u.size, w, h);
      gl.uniform1f(u.dpr, f.dpr);
      gl.uniform1f(u.feature, f.feature);
      gl.uniform1f(u.z, f.z);
      gl.uniform1f(u.step, f.step);
      gl.uniform1f(u.amount, f.amount);
      gl.uniform1f(u.lift, f.lift);
      gl.uniform2f(u.hill, f.hill[0], f.hill[1]);
      gl.uniform4fv(u.ripples, f.ripples);
      gl.uniform1f(u.reach, f.reach);
      gl.uniform3f(u.color, f.color[0], f.color[1], f.color[2]);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
  }

  /* ------------------------------------------------------------ Canvas 2D fallback (marching squares) */

  function createContours(edges) {
    return {
      segments: new Float64Array(0),
      count: 0,
      used: new Uint8Array(0),
      first: new Int32Array(edges).fill(-1),
      second: new Int32Array(edges).fill(-1),
      points: new Float64Array(0),
      scratch: new Float64Array(0),
    };
  }

  function addSegment(c, edgeA, xA, yA, edgeB, xB, yB) {
    if ((c.count + 1) * 6 > c.segments.length) {
      var capacity = Math.max(256, c.count * 2);
      var segments = new Float64Array(capacity * 6);
      segments.set(c.segments);
      c.segments = segments;
      c.used = new Uint8Array(capacity);
      c.points = new Float64Array(capacity * 4 + 16);
      c.scratch = new Float64Array(capacity * 4 + 16);
    }
    var o = c.count * 6;
    var s = c.segments;
    s[o] = edgeA;
    s[o + 1] = xA;
    s[o + 2] = yA;
    s[o + 3] = edgeB;
    s[o + 4] = xB;
    s[o + 5] = yB;
    c.count += 1;
  }

  function link(c, edge, segment) {
    if (c.first[edge] < 0) c.first[edge] = segment;
    else c.second[edge] = segment;
  }

  function neighbour(c, edge, segment) {
    var a = c.first[edge];
    var next = a === segment ? c.second[edge] : a;
    return next >= 0 && !c.used[next] ? next : -1;
  }

  function relax(pts, start, n, closed, scratch) {
    for (var pass = 0; pass < RELAX; pass += 1) {
      scratch.set(pts.subarray(start, start + n * 2));
      for (var i = closed ? 0 : 1; i < (closed ? n : n - 1); i += 1) {
        var a = ((i - 1 + n) % n) * 2;
        var b = ((i + 1) % n) * 2;
        pts[start + i * 2] = (scratch[a] + 2 * scratch[i * 2] + scratch[b]) / 4;
        pts[start + i * 2 + 1] = (scratch[a + 1] + 2 * scratch[i * 2 + 1] + scratch[b + 1]) / 4;
      }
    }
  }

  function at(start, n, i) {
    return start + ((i + n) % n) * 2;
  }

  function smooth(path, pts, start, end, closed, scratch) {
    var n = (end - start) / 2;
    if (n < 2) return;
    if (n > 3) relax(pts, start, n, closed, scratch);
    var i;
    if (closed && n > 2) {
      var last = at(start, n, -1);
      path.moveTo((pts[last] + pts[start]) / 2, (pts[last + 1] + pts[start + 1]) / 2);
      for (i = 0; i < n; i += 1) {
        var p = at(start, n, i);
        var q = at(start, n, i + 1);
        path.quadraticCurveTo(pts[p], pts[p + 1], (pts[p] + pts[q]) / 2, (pts[p + 1] + pts[q + 1]) / 2);
      }
      return;
    }
    path.moveTo(pts[start], pts[start + 1]);
    for (i = 1; i < n - 1; i += 1) {
      var k = start + i * 2;
      path.quadraticCurveTo(pts[k], pts[k + 1], (pts[k] + pts[k + 2]) / 2, (pts[k + 1] + pts[k + 3]) / 2);
    }
    path.lineTo(pts[end - 2], pts[end - 1]);
  }

  function traceLevel(path, c) {
    var s = c.segments;
    var pts = c.points;
    var i;
    for (i = 0; i < c.count; i += 1) {
      c.used[i] = 0;
      link(c, s[i * 6], i);
      link(c, s[i * 6 + 3], i);
    }
    var middle = (pts.length >> 2) << 1;
    for (var start = 0; start < c.count; start += 1) {
      if (c.used[start]) continue;
      c.used[start] = 1;
      var o = start * 6;
      var head = middle;
      var tail = middle;
      pts[tail++] = s[o + 1];
      pts[tail++] = s[o + 2];
      pts[tail++] = s[o + 4];
      pts[tail++] = s[o + 5];
      var current = start;
      var edge = s[o + 3];
      var next;
      var n;
      var far;
      for (;;) {
        next = neighbour(c, edge, current);
        if (next < 0) break;
        c.used[next] = 1;
        n = next * 6;
        far = s[n] === edge ? 3 : 0;
        pts[tail++] = s[n + far + 1];
        pts[tail++] = s[n + far + 2];
        edge = s[n + far];
        current = next;
      }
      var closed = edge === s[o] && tail - head > 6;
      if (closed) {
        tail -= 2;
      } else {
        current = start;
        edge = s[o];
        for (;;) {
          next = neighbour(c, edge, current);
          if (next < 0) break;
          c.used[next] = 1;
          n = next * 6;
          far = s[n] === edge ? 3 : 0;
          pts[--head] = s[n + far + 2];
          pts[--head] = s[n + far + 1];
          edge = s[n + far];
          current = next;
        }
      }
      smooth(path, pts, head, tail, closed, c.scratch);
    }
    for (i = 0; i < c.count; i += 1) {
      var from = s[i * 6];
      var to = s[i * 6 + 3];
      c.first[from] = c.second[from] = -1;
      c.first[to] = c.second[to] = -1;
    }
    c.count = 0;
  }

  function createCanvasRenderer(context) {
    var cols = 0;
    var rows = 0;
    var field = new Float32Array(0);
    var levelLow = new Int16Array(0);
    var levelHigh = new Int16Array(0);
    var bucketStart = new Int32Array(0);
    var bucketCells = new Int32Array(0);
    var contours = createContours(0);

    function resize(width, height) {
      cols = Math.ceil(width / CELL) + 1;
      rows = Math.ceil(height / CELL) + 1;
      field = new Float32Array((cols + 1) * (rows + 1));
      levelLow = new Int16Array(rows * cols);
      levelHigh = new Int16Array(rows * cols);
      contours = createContours(2 * (rows + 1) * (cols + 1) + 4);
    }

    function sample(f) {
      var i = 0;
      for (var row = 0; row <= rows; row += 1) {
        var y = row * CELL;
        for (var col = 0; col <= cols; col += 1) {
          var x = col * CELL;
          var nx = x / f.feature;
          var ny = y / f.feature;
          var value = noise(nx, ny, f.z) * 1.1 + noise(nx * 2.1, ny * 2.1, f.z * 1.7) * 0.45;
          if (f.lift > 0) value += f.lift * Math.exp(-Math.hypot(x - f.hill[0], y - f.hill[1]) / HILL_RADIUS);
          for (var r = 0; r < 4; r += 1) {
            if (f.ripples[r * 4 + 3] < 0.5) continue;
            var p = f.ripples[r * 4 + 2];
            var d = Math.hypot(x - f.ripples[r * 4], y - f.ripples[r * 4 + 1]) - p * f.reach;
            value += 0.9 * (1 - p) * Math.cos((d / RIPPLE_WIDTH) * 1.8) * Math.exp(-(d * d) / (2 * RIPPLE_WIDTH * RIPPLE_WIDTH));
          }
          field[i++] = value * f.amount;
        }
      }
    }

    function draw(f) {
      sample(f);
      var step = f.step;
      var minor = new Path2D();
      var major = new Path2D();
      var stride = cols + 1;
      var lowest = Infinity;
      var highest = -Infinity;
      var row;
      var col;
      var cell;
      var level;

      for (row = 0; row < rows; row += 1) {
        for (col = 0; col < cols; col += 1) {
          var idx = row * stride + col;
          var a0 = field[idx];
          var b0 = field[idx + 1];
          var c0 = field[idx + stride + 1];
          var d0 = field[idx + stride];
          var first = Math.ceil((Math.min(a0, b0, c0, d0) + RANGE) / step);
          var last = Math.floor((Math.max(a0, b0, c0, d0) + RANGE) / step);
          levelLow[row * cols + col] = first;
          levelHigh[row * cols + col] = last;
          if (first < lowest) lowest = first;
          if (last > highest) highest = last;
        }
      }

      var span = highest - lowest + 1;
      if (!(span > 0)) return null;
      if (bucketStart.length < span + 1) bucketStart = new Int32Array(span + 1);
      bucketStart.fill(0, 0, span + 1);
      var entries = 0;
      for (cell = 0; cell < rows * cols; cell += 1) {
        for (level = levelLow[cell]; level <= levelHigh[cell]; level += 1) {
          bucketStart[level - lowest + 1] += 1;
          entries += 1;
        }
      }
      for (var l = 0; l < span; l += 1) bucketStart[l + 1] += bucketStart[l];
      if (bucketCells.length < entries) bucketCells = new Int32Array(entries * 2);
      var fill = bucketStart.slice(0, span);
      for (cell = 0; cell < rows * cols; cell += 1) {
        for (level = levelLow[cell]; level <= levelHigh[cell]; level += 1) bucketCells[fill[level - lowest]++] = cell;
      }

      for (level = lowest; level <= highest; level += 1) {
        var v = level * step - RANGE;
        var end = bucketStart[level - lowest + 1];
        for (var e = bucketStart[level - lowest]; e < end; e += 1) {
          cell = bucketCells[e];
          row = (cell / cols) | 0;
          col = cell - row * cols;
          var i = row * stride + col;
          var a = field[i];
          var b = field[i + 1];
          var c = field[i + stride + 1];
          var d = field[i + stride];
          var code = (a > v ? 8 : 0) | (b > v ? 4 : 0) | (c > v ? 2 : 0) | (d > v ? 1 : 0);
          if (code === 0 || code === 15) continue;
          var x = col * CELL;
          var y = row * CELL;
          var top = x + ((v - a) / (b - a)) * CELL;
          var right = y + ((v - b) / (c - b)) * CELL;
          var bottom = x + ((v - d) / (c - d)) * CELL;
          var left = y + ((v - a) / (d - a)) * CELL;
          var T = i * 2;
          var Bt = T + stride * 2;
          var L = T + 1;
          var R = T + 3;
          var k = contours;
          switch (code) {
            case 1: case 14: addSegment(k, L, x, left, Bt, bottom, y + CELL); break;
            case 2: case 13: addSegment(k, Bt, bottom, y + CELL, R, x + CELL, right); break;
            case 3: case 12: addSegment(k, L, x, left, R, x + CELL, right); break;
            case 4: case 11: addSegment(k, T, top, y, R, x + CELL, right); break;
            case 6: case 9: addSegment(k, T, top, y, Bt, bottom, y + CELL); break;
            case 7: case 8: addSegment(k, L, x, left, T, top, y); break;
            case 5:
            case 10: {
              var center = (a + b + c + d) / 4 > v;
              if ((code === 5) === center) {
                addSegment(k, L, x, left, T, top, y);
                addSegment(k, Bt, bottom, y + CELL, R, x + CELL, right);
              } else {
                addSegment(k, L, x, left, Bt, bottom, y + CELL);
                addSegment(k, T, top, y, R, x + CELL, right);
              }
              break;
            }
            default:
              break;
          }
        }
        traceLevel(level % 5 === 0 ? major : minor, contours);
      }

      context.setTransform(f.dpr, 0, 0, f.dpr, 0, 0);
      context.clearRect(0, 0, f.width, f.height);
      context.strokeStyle = f.css;
      context.lineCap = 'round';
      context.globalAlpha = 0.4;
      context.lineWidth = 1;
      context.stroke(minor);
      context.globalAlpha = 0.85;
      context.lineWidth = 1.5;
      context.stroke(major);
      context.globalAlpha = 1;
      return null;
    }

    return { resize: resize, draw: draw };
  }

  /* ------------------------------------------------------------ color */

  var probe = document.createElement('canvas').getContext('2d');
  function toRgb(color) {
    if (!probe) return [0.45, 0.45, 0.45];
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = color;
    probe.fillRect(0, 0, 1, 1);
    var d = probe.getImageData(0, 0, 1, 1).data;
    return [d[0] / 255, d[1] / 255, d[2] / 255];
  }

  /* ------------------------------------------------------------ setup */

  var reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  var reduce = reduceQuery.matches;

  var gl = canvas.getContext('webgl', { premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false });
  var glRender = gl ? createGlRenderer(gl) : null;
  var cpu = null;
  if (!glRender) {
    var context2d = canvas.getContext('2d');
    if (!context2d) return;
    cpu = createCanvasRenderer(context2d);
  }
  var pace = glRender ? 0 : MIN_FRAME;

  // Springs from the original: the hill follows the pointer (120/20) and rises or settles (80/18).
  var hillX = new Spring(0, 120, 20);
  var hillY = new Spring(0, 120, 20);
  var hill = new Spring(0, 80, 18);
  var riseStart = null;
  var rise = reduce ? 1 : 0;
  var ripples = [];
  var rippleData = new Float32Array(16);

  var width = 0;
  var height = 0;
  var dpr = 1;
  var time = 0;
  var frames = 0;
  var cssColor = '';
  var rgb = [0.45, 0.45, 0.45];

  function readColor(force) {
    if (!force && frames % 30 !== 0) return;
    var color = window.getComputedStyle(container).color || '#737373';
    if (color !== cssColor) {
      cssColor = color;
      rgb = toRgb(color);
    }
  }

  function resize() {
    var rect = container.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    if (cpu) cpu.resize(width, height);
    if (hill.value === 0 && hill.target === 0) {
      hillX.jump(width / 2);
      hillY.jump(height / 2);
    }
  }

  function draw(looping) {
    if (width === 0 || height === 0) return;
    readColor(!looping);
    frames += 1;
    rippleData.fill(0);
    ripples.slice(-4).forEach(function (ripple, i) {
      rippleData[i * 4] = ripple.x;
      rippleData[i * 4 + 1] = ripple.y;
      rippleData[i * 4 + 2] = ripple.progress;
      rippleData[i * 4 + 3] = 1;
    });
    var f = {
      width: width,
      height: height,
      dpr: dpr,
      feature: FEATURE * SCALE,
      z: time * 0.00005 * SPEED,
      step: (2 * RANGE) / Math.max(2, Math.round(LEVELS)),
      amount: rise,
      lift: hill.value * PEAK * 1.5,
      hill: [hillX.value, hillY.value],
      ripples: rippleData,
      reach: Math.hypot(width, height) * 0.8,
      color: rgb,
      css: cssColor,
    };
    if (glRender) glRender(f);
    else cpu.draw(f);
  }

  /* ------------------------------------------------------------ animation loop */

  var raf = null;
  var lastTick = 0;
  var waited = 0;

  function playing() {
    return !reduce && document.visibilityState === 'visible';
  }

  function tick(now) {
    raf = null;
    if (!playing()) return;
    var delta = lastTick ? now - lastTick : 16;
    lastTick = now;
    var dt = Math.min(delta, 64) / 1000;

    hillX.step(dt);
    hillY.step(dt);
    hill.step(dt);
    if (riseStart === null) riseStart = now;
    rise = riseEase(Math.min(1, (now - riseStart) / 1800));
    ripples = ripples.filter(function (ripple) {
      ripple.progress = rippleEase(Math.min(1, (now - ripple.start) / 2600));
      return now - ripple.start < 2600;
    });

    waited += delta;
    if (waited >= pace) {
      time += Math.min(waited, 64);
      waited = 0;
      draw(true);
    }
    raf = window.requestAnimationFrame(tick);
  }

  function start() {
    if (raf || !playing()) return;
    lastTick = 0;
    raf = window.requestAnimationFrame(tick);
  }

  function stop() {
    if (raf) window.cancelAnimationFrame(raf);
    raf = null;
  }

  /* ------------------------------------------------------------ interaction */

  // The map sits behind the page, so pointer input is read from the whole window.
  window.addEventListener('pointermove', function (event) {
    if (reduce) return;
    var rect = container.getBoundingClientRect();
    hillX.target = event.clientX - rect.left;
    hillY.target = event.clientY - rect.top;
    hill.target = 1;
  }, { passive: true });

  document.documentElement.addEventListener('pointerleave', function () {
    hill.target = 0;
  });
  window.addEventListener('blur', function () {
    hill.target = 0;
  });

  window.addEventListener('pointerdown', function (event) {
    if (reduce) return;
    var rect = container.getBoundingClientRect();
    var x = event.clientX - rect.left;
    var y = event.clientY - rect.top;
    hillX.target = x;
    hillY.target = y;
    ripples = ripples.slice(-3).concat([{ x: x, y: y, start: performance.now(), progress: 0 }]);
  }, { passive: true });

  document.addEventListener('visibilitychange', function () {
    if (playing()) start();
    else stop();
  });

  if (reduceQuery.addEventListener) {
    reduceQuery.addEventListener('change', function () {
      reduce = reduceQuery.matches;
      if (reduce) {
        stop();
        rise = 1;
        hill.jump(0);
        ripples = [];
        draw(false);
      } else {
        start();
      }
    });
  }

  // Redraw a still frame when the theme changes (reduced motion keeps no loop running).
  new MutationObserver(function () {
    draw(false);
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
    draw(false);
  });

  new ResizeObserver(function () {
    resize();
    draw(false);
  }).observe(container);

  resize();
  draw(false);
  document.documentElement.classList.add('has-topography');
  start();
})();
