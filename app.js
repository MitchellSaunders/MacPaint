(() => {
  const mainCanvas = document.getElementById('mainCanvas');
  const overlay = document.getElementById('overlayCanvas');
  const wrap = document.getElementById('canvasWrap');
  const mctx = mainCanvas.getContext('2d');
  const octx = overlay.getContext('2d');

  const state = {
    tool: 'select',
    primary: '#000000',
    secondary: '#ffffff',
    size: 4,
    shapeMode: 'outline',
    drawing: false,
    lastPt: null,
    startPt: null,
    button: 0,
    clipboard: null, // {canvas,w,h}
  };

  // ---------- canvas sizing ----------
  function setCanvasSize(w, h, fill = true) {
    const prev = fill ? null : mainCanvas.toDataURL();
    mainCanvas.width = w; mainCanvas.height = h;
    overlay.width = w; overlay.height = h;
    wrap.style.width = w + 'px';
    wrap.style.height = h + 'px';
    document.getElementById('canvasSize').textContent = `${w} x ${h}`;
    if (fill) {
      mctx.fillStyle = '#ffffff';
      mctx.fillRect(0, 0, w, h);
    }
  }
  setCanvasSize(800, 600, true);

  // ---------- history (undo/redo) ----------
  const history = { stack: [], index: -1, max: 40 };
  function pushHistory() {
    const snap = mainCanvas.toDataURL();
    history.stack = history.stack.slice(0, history.index + 1);
    history.stack.push(snap);
    if (history.stack.length > history.max) history.stack.shift();
    history.index = history.stack.length - 1;
  }
  let restoreToken = 0;
  function restoreHistory(i) {
    if (i < 0 || i >= history.stack.length) return;
    const token = ++restoreToken;
    const img = new Image();
    img.onload = () => {
      if (token !== restoreToken) return; // a newer restore was requested since this one started; discard
      if (img.width !== mainCanvas.width || img.height !== mainCanvas.height) {
        setCanvasSize(img.width, img.height, false);
      }
      mctx.clearRect(0, 0, mainCanvas.width, mainCanvas.height);
      mctx.drawImage(img, 0, 0);
    };
    img.src = history.stack[i];
    history.index = i;
  }
  function undo() { if (history.index > 0) restoreHistory(history.index - 1); }
  function redo() { if (history.index < history.stack.length - 1) restoreHistory(history.index + 1); }
  pushHistory();

  // ---------- selection tool state ----------
  const sel = {
    active: false,       // a selection rectangle exists (marquee shown)
    floating: false,      // pixels have been lifted off the main canvas into buffer
    x: 0, y: 0, w: 0, h: 0,
    buffer: null,          // offscreen canvas holding the lifted pixels
    mode: 'idle',           // idle | creating | moving | resizing
    handle: null,
    dragOffsetX: 0, dragOffsetY: 0,
    resizeAnchor: null,     // {x,y} fixed corner while resizing
  };

  function clampRect(x, y, w, h) {
    if (w < 0) { x += w; w = -w; }
    if (h < 0) { y += h; h = -h; }
    x = Math.max(0, Math.min(x, mainCanvas.width));
    y = Math.max(0, Math.min(y, mainCanvas.height));
    w = Math.min(w, mainCanvas.width - x);
    h = Math.min(h, mainCanvas.height - y);
    return { x, y, w, h };
  }

  function liftSelection() {
    if (sel.floating) return;
    const buf = document.createElement('canvas');
    buf.width = Math.max(1, sel.w);
    buf.height = Math.max(1, sel.h);
    buf.getContext('2d').drawImage(mainCanvas, sel.x, sel.y, sel.w, sel.h, 0, 0, sel.w, sel.h);
    sel.buffer = buf;
    mctx.fillStyle = state.secondary;
    mctx.fillRect(sel.x, sel.y, sel.w, sel.h);
    sel.floating = true;
  }

  function commitSelection() {
    if (sel.active && sel.floating && sel.buffer) {
      mctx.drawImage(sel.buffer, sel.x, sel.y, sel.w, sel.h);
      pushHistory();
    }
    sel.active = false;
    sel.floating = false;
    sel.buffer = null;
    sel.mode = 'idle';
    clearOverlay();
    updateImageButtons();
  }

  function deleteSelectionContents() {
    if (!sel.active) return;
    if (!sel.floating) {
      mctx.fillStyle = state.secondary;
      mctx.fillRect(sel.x, sel.y, sel.w, sel.h);
      pushHistory();
    }
    sel.active = false;
    sel.floating = false;
    sel.buffer = null;
    sel.mode = 'idle';
    clearOverlay();
    updateImageButtons();
  }

  function updateImageButtons() {
    document.getElementById('cropBtn').disabled = !sel.active;
  }

  function clearOverlay() { octx.clearRect(0, 0, overlay.width, overlay.height); }

  function drawSelectionOverlay() {
    updateImageButtons();
    clearOverlay();
    if (!sel.active) return;
    if (sel.floating && sel.buffer) {
      octx.drawImage(sel.buffer, sel.x, sel.y, sel.w, sel.h);
    }
    octx.save();
    octx.strokeStyle = '#3a6ea5';
    octx.lineWidth = 1;
    octx.setLineDash([4, 3]);
    octx.strokeRect(sel.x + 0.5, sel.y + 0.5, sel.w, sel.h);
    octx.restore();
    // resize handles
    const hs = 7;
    for (const h of getHandles()) {
      octx.fillStyle = '#fff';
      octx.strokeStyle = '#3a6ea5';
      octx.lineWidth = 1;
      octx.fillRect(h.x - hs / 2, h.y - hs / 2, hs, hs);
      octx.strokeRect(h.x - hs / 2, h.y - hs / 2, hs, hs);
    }
  }

  function getHandles() {
    const { x, y, w, h } = sel;
    return [
      { name: 'nw', x, y },
      { name: 'n', x: x + w / 2, y },
      { name: 'ne', x: x + w, y },
      { name: 'e', x: x + w, y: y + h / 2 },
      { name: 'se', x: x + w, y: y + h },
      { name: 's', x: x + w / 2, y: y + h },
      { name: 'sw', x, y: y + h },
      { name: 'w', x, y: y + h / 2 },
    ];
  }

  function hitHandle(px, py) {
    const hs = 8;
    for (const h of getHandles()) {
      if (Math.abs(px - h.x) <= hs && Math.abs(py - h.y) <= hs) return h.name;
    }
    return null;
  }

  function cursorForHandle(name) {
    const map = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };
    return map[name] || 'crosshair';
  }

  // ---------- image editing (crop / rotate / flip / resize) ----------
  function cropToSelection() {
    if (!sel.active || sel.w < 1 || sel.h < 1) return;
    const { x, y, w, h } = sel;
    if (sel.floating) commitSelection();
    const buf = document.createElement('canvas');
    buf.width = w; buf.height = h;
    buf.getContext('2d').drawImage(mainCanvas, x, y, w, h, 0, 0, w, h);
    sel.active = false;
    sel.floating = false;
    sel.buffer = null;
    sel.mode = 'idle';
    clearOverlay();
    updateImageButtons();
    setCanvasSize(w, h, false);
    mctx.clearRect(0, 0, w, h);
    mctx.drawImage(buf, 0, 0);
    pushHistory();
  }

  function rotateCanvas(clockwise) {
    if (sel.active) commitSelection();
    const oldW = mainCanvas.width, oldH = mainCanvas.height;
    const buf = document.createElement('canvas');
    buf.width = oldW; buf.height = oldH;
    buf.getContext('2d').drawImage(mainCanvas, 0, 0);
    setCanvasSize(oldH, oldW, true);
    mctx.save();
    mctx.translate(oldH / 2, oldW / 2);
    mctx.rotate((clockwise ? 90 : -90) * Math.PI / 180);
    mctx.drawImage(buf, -oldW / 2, -oldH / 2);
    mctx.restore();
    pushHistory();
  }

  function flipCanvas(axis) {
    if (sel.active) commitSelection();
    const w = mainCanvas.width, h = mainCanvas.height;
    const buf = document.createElement('canvas');
    buf.width = w; buf.height = h;
    buf.getContext('2d').drawImage(mainCanvas, 0, 0);
    mctx.clearRect(0, 0, w, h);
    mctx.save();
    if (axis === 'h') { mctx.translate(w, 0); mctx.scale(-1, 1); }
    else { mctx.translate(0, h); mctx.scale(1, -1); }
    mctx.drawImage(buf, 0, 0);
    mctx.restore();
    pushHistory();
  }

  function resizeImage(w, h) {
    if (sel.active) commitSelection();
    const buf = document.createElement('canvas');
    buf.width = mainCanvas.width; buf.height = mainCanvas.height;
    buf.getContext('2d').drawImage(mainCanvas, 0, 0);
    setCanvasSize(w, h, true);
    mctx.drawImage(buf, 0, 0, buf.width, buf.height, 0, 0, w, h);
    pushHistory();
  }

  // ---------- coordinate helpers ----------
  function getPos(e) {
    const r = overlay.getBoundingClientRect();
    const scaleX = overlay.width / r.width;
    const scaleY = overlay.height / r.height;
    let x = Math.round((e.clientX - r.left) * scaleX);
    let y = Math.round((e.clientY - r.top) * scaleY);
    x = Math.max(0, Math.min(x, mainCanvas.width));
    y = Math.max(0, Math.min(y, mainCanvas.height));
    return { x, y };
  }

  // ---------- freehand / shape drawing ----------
  function strokeColor() { return state.button === 2 ? state.secondary : state.primary; }

  function drawDot(ctx, x, y, size, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, size / 2, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawSegment(ctx, from, to, size, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    drawDot(ctx, to.x, to.y, size, color);
  }

  function floodFill(x, y, fillColor) {
    const w = mainCanvas.width, h = mainCanvas.height;
    const imgData = mctx.getImageData(0, 0, w, h);
    const data = imgData.data;
    const idx = (px, py) => (py * w + px) * 4;
    const startIdx = idx(x, y);
    const target = [data[startIdx], data[startIdx + 1], data[startIdx + 2], data[startIdx + 3]];
    const fc = hexToRgb(fillColor);
    if (target[0] === fc.r && target[1] === fc.g && target[2] === fc.b && target[3] === 255) return;
    const match = (i) => data[i] === target[0] && data[i + 1] === target[1] && data[i + 2] === target[2] && data[i + 3] === target[3];
    const stack = [[x, y]];
    while (stack.length) {
      const [cx, cy] = stack.pop();
      if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue;
      const i = idx(cx, cy);
      if (!match(i)) continue;
      data[i] = fc.r; data[i + 1] = fc.g; data[i + 2] = fc.b; data[i + 3] = 255;
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
    mctx.putImageData(imgData, 0, 0);
  }

  function hexToRgb(hex) {
    const v = hex.replace('#', '');
    return { r: parseInt(v.substr(0, 2), 16), g: parseInt(v.substr(2, 2), 16), b: parseInt(v.substr(4, 2), 16) };
  }

  function drawShapePreview(ctx, tool, start, end, size, color, mode) {
    ctx.lineWidth = size;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineCap = 'round';
    if (tool === 'line') {
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
    } else if (tool === 'rect') {
      const r = clampRect(start.x, start.y, end.x - start.x, end.y - start.y);
      if (mode !== 'outline') ctx.fillRect(r.x, r.y, r.w, r.h);
      if (mode !== 'fill') ctx.strokeRect(r.x, r.y, r.w, r.h);
    } else if (tool === 'ellipse') {
      const r = clampRect(start.x, start.y, end.x - start.x, end.y - start.y);
      ctx.beginPath();
      ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
      if (mode !== 'outline') ctx.fill();
      if (mode !== 'fill') ctx.stroke();
    }
  }

  // ---------- text tool ----------
  let textInput = null;
  function startTextInput(x, y) {
    finishTextInput();
    textInput = document.createElement('textarea');
    textInput.style.position = 'absolute';
    textInput.style.left = x + 'px';
    textInput.style.top = y + 'px';
    textInput.style.font = Math.max(12, state.size * 4) + 'px sans-serif';
    textInput.style.color = state.primary;
    textInput.style.background = 'transparent';
    textInput.style.border = '1px dashed #3a6ea5';
    textInput.style.outline = 'none';
    textInput.style.resize = 'none';
    textInput.style.minWidth = '80px';
    textInput.style.minHeight = '1.4em';
    textInput.style.padding = '0';
    textInput.style.lineHeight = '1.2';
    wrap.appendChild(textInput);
    textInput.focus();
    textInput._pos = { x, y };
    textInput.addEventListener('blur', finishTextInput);
  }
  function finishTextInput() {
    if (!textInput) return;
    const input = textInput;
    textInput = null;
    input.removeEventListener('blur', finishTextInput);
    const val = input.value;
    const { x, y } = input._pos;
    const fontSize = Math.max(12, state.size * 4);
    if (val.trim()) {
      mctx.fillStyle = state.primary;
      mctx.font = fontSize + 'px sans-serif';
      mctx.textBaseline = 'top';
      val.split('\n').forEach((line, i) => mctx.fillText(line, x, y + i * fontSize * 1.2));
      pushHistory();
    }
    input.remove();
  }

  // ---------- pointer events ----------
  overlay.addEventListener('contextmenu', (e) => e.preventDefault());

  overlay.addEventListener('mousedown', (e) => {
    e.preventDefault();
    if (textInput) { finishTextInput(); }
    const pos = getPos(e);
    state.button = e.button;
    document.getElementById('coords').textContent = `${pos.x}, ${pos.y}`;

    if (state.tool === 'select') {
      if (sel.active) {
        const handle = hitHandle(pos.x, pos.y);
        if (handle) {
          sel.mode = 'resizing';
          sel.handle = handle;
          liftSelection();
          // anchor is the fixed corner opposite the handle being dragged
          const anchors = { se: { x: sel.x, y: sel.y }, sw: { x: sel.x + sel.w, y: sel.y }, ne: { x: sel.x, y: sel.y + sel.h }, nw: { x: sel.x + sel.w, y: sel.y + sel.h }, n: { x: sel.x, y: sel.y + sel.h }, s: { x: sel.x, y: sel.y }, e: { x: sel.x, y: sel.y }, w: { x: sel.x + sel.w, y: sel.y } };
          sel.resizeAnchor = anchors[handle];
          return;
        }
        if (pos.x >= sel.x && pos.x <= sel.x + sel.w && pos.y >= sel.y && pos.y <= sel.y + sel.h) {
          sel.mode = 'moving';
          liftSelection();
          sel.dragOffsetX = pos.x - sel.x;
          sel.dragOffsetY = pos.y - sel.y;
          return;
        }
        // clicked outside existing selection: commit it, then start a new one
        commitSelection();
      }
      sel.active = true;
      sel.floating = false;
      sel.mode = 'creating';
      sel.x = pos.x; sel.y = pos.y; sel.w = 0; sel.h = 0;
      state.startPt = pos;
      return;
    }

    state.drawing = true;
    state.startPt = pos;
    state.lastPt = pos;

    if (state.tool === 'pencil' || state.tool === 'brush') {
      drawDot(mctx, pos.x, pos.y, state.size, strokeColor());
    } else if (state.tool === 'eraser') {
      drawDot(mctx, pos.x, pos.y, Math.max(state.size, 8), state.secondary);
    } else if (state.tool === 'fill') {
      floodFill(pos.x, pos.y, strokeColor());
      pushHistory();
      state.drawing = false;
    } else if (state.tool === 'eyedropper') {
      const d = mctx.getImageData(pos.x, pos.y, 1, 1).data;
      const hex = '#' + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join('');
      if (e.button === 2) setSecondary(hex); else setPrimary(hex);
      state.drawing = false;
    } else if (state.tool === 'text') {
      startTextInput(pos.x, pos.y);
      state.drawing = false;
    }
  });

  overlay.addEventListener('mousemove', (e) => {
    const pos = getPos(e);
    document.getElementById('coords').textContent = `${pos.x}, ${pos.y}`;

    if (state.tool === 'select') {
      if (sel.mode === 'creating') {
        const r = clampRect(state.startPt.x, state.startPt.y, pos.x - state.startPt.x, pos.y - state.startPt.y);
        sel.x = r.x; sel.y = r.y; sel.w = r.w; sel.h = r.h;
        drawSelectionOverlay();
      } else if (sel.mode === 'moving') {
        sel.x = Math.max(0, Math.min(pos.x - sel.dragOffsetX, mainCanvas.width - sel.w));
        sel.y = Math.max(0, Math.min(pos.y - sel.dragOffsetY, mainCanvas.height - sel.h));
        drawSelectionOverlay();
      } else if (sel.mode === 'resizing') {
        const a = sel.resizeAnchor;
        let nx = Math.min(a.x, pos.x), ny = Math.min(a.y, pos.y);
        let nw = Math.abs(pos.x - a.x), nh = Math.abs(pos.y - a.y);
        if (sel.handle === 'n' || sel.handle === 's') { nx = sel.x; nw = sel.w; }
        if (sel.handle === 'e' || sel.handle === 'w') { ny = sel.y; nh = sel.h; }
        sel.x = nx; sel.y = ny; sel.w = Math.max(1, nw); sel.h = Math.max(1, nh);
        drawSelectionOverlay();
      } else if (sel.active) {
        const handle = hitHandle(pos.x, pos.y);
        overlay.style.cursor = handle ? cursorForHandle(handle) :
          (pos.x >= sel.x && pos.x <= sel.x + sel.w && pos.y >= sel.y && pos.y <= sel.y + sel.h ? 'move' : 'crosshair');
      }
      return;
    }

    if (!state.drawing) return;

    if (state.tool === 'pencil' || state.tool === 'brush') {
      drawSegment(mctx, state.lastPt, pos, state.size, strokeColor());
      state.lastPt = pos;
    } else if (state.tool === 'eraser') {
      drawSegment(mctx, state.lastPt, pos, Math.max(state.size, 8), state.secondary);
      state.lastPt = pos;
    } else if (state.tool === 'line' || state.tool === 'rect' || state.tool === 'ellipse') {
      clearOverlay();
      drawShapePreview(octx, state.tool, state.startPt, pos, state.size, strokeColor(), state.shapeMode);
    }
  });

  window.addEventListener('mouseup', (e) => {
    if (state.tool === 'select') {
      if (sel.mode === 'creating') {
        if (sel.w < 1 || sel.h < 1) { sel.active = false; clearOverlay(); }
        sel.mode = 'idle';
        drawSelectionOverlay();
      } else if (sel.mode === 'moving' || sel.mode === 'resizing') {
        sel.mode = 'idle';
        drawSelectionOverlay();
      }
      return;
    }
    if (!state.drawing) return;
    state.drawing = false;
    const pos = getPos(e);
    if (state.tool === 'line' || state.tool === 'rect' || state.tool === 'ellipse') {
      clearOverlay();
      drawShapePreview(mctx, state.tool, state.startPt, pos, state.size, strokeColor(), state.shapeMode);
    }
    pushHistory();
  });

  // ---------- keyboard ----------
  window.addEventListener('keydown', (e) => {
    const meta = e.metaKey || e.ctrlKey;
    if (textInput) {
      if (e.key === 'Escape') { textInput.value = ''; finishTextInput(); }
      return;
    }
    if (meta && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
      return;
    }
    if (meta && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (meta && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      selectTool('select');
      sel.active = true; sel.floating = false; sel.mode = 'idle';
      sel.x = 0; sel.y = 0; sel.w = mainCanvas.width; sel.h = mainCanvas.height;
      drawSelectionOverlay();
      return;
    }
    if (sel.active) {
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelectionContents(); return; }
      if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); commitSelection(); return; }
      const nudge = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[e.key];
      if (nudge) {
        e.preventDefault();
        liftSelection();
        sel.x = Math.max(0, Math.min(sel.x + nudge[0], mainCanvas.width - sel.w));
        sel.y = Math.max(0, Math.min(sel.y + nudge[1], mainCanvas.height - sel.h));
        drawSelectionOverlay();
        return;
      }
      if (meta && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        const c = document.createElement('canvas');
        c.width = sel.w; c.height = sel.h;
        if (sel.floating && sel.buffer) c.getContext('2d').drawImage(sel.buffer, 0, 0);
        else c.getContext('2d').drawImage(mainCanvas, sel.x, sel.y, sel.w, sel.h, 0, 0, sel.w, sel.h);
        state.clipboard = c;
        return;
      }
      if (meta && e.key.toLowerCase() === 'x') {
        e.preventDefault();
        const c = document.createElement('canvas');
        c.width = sel.w; c.height = sel.h;
        c.getContext('2d').drawImage(sel.floating && sel.buffer ? sel.buffer : mainCanvas, sel.floating ? 0 : sel.x, sel.floating ? 0 : sel.y, sel.floating ? sel.w : sel.w, sel.floating ? sel.h : sel.h, 0, 0, sel.w, sel.h);
        state.clipboard = c;
        deleteSelectionContents();
        return;
      }
    }
    if (meta && e.key.toLowerCase() === 'v' && state.clipboard) {
      e.preventDefault();
      commitSelection();
      selectTool('select');
      sel.active = true;
      sel.x = 0; sel.y = 0; sel.w = state.clipboard.width; sel.h = state.clipboard.height;
      sel.buffer = state.clipboard;
      sel.floating = true;
      sel.mode = 'idle';
      drawSelectionOverlay();
      return;
    }
    const shortcuts = { s: 'select', p: 'pencil', b: 'brush', e: 'eraser', f: 'fill', k: 'eyedropper', l: 'line', r: 'rect', o: 'ellipse', t: 'text' };
    if (!meta && shortcuts[e.key.toLowerCase()] && document.activeElement === document.body) {
      selectTool(shortcuts[e.key.toLowerCase()]);
    }
  });

  // ---------- toolbar wiring ----------
  function selectTool(name) {
    if (state.tool === 'select' && name !== 'select' && sel.active) commitSelection();
    state.tool = name;
    document.querySelectorAll('.tool').forEach(b => b.classList.toggle('active', b.dataset.tool === name));
    overlay.style.cursor = name === 'select' ? 'crosshair' : 'crosshair';
    document.getElementById('fillModeRow').style.display = (name === 'rect' || name === 'ellipse') ? 'flex' : 'none';
    const hints = {
      select: 'Rectangle Select: drag to select, drag inside to move, drag handles to resize, Delete to clear, Enter/Escape to commit.',
      pencil: 'Pencil: click and drag to draw a freehand line.',
      brush: 'Brush: click and drag to paint.',
      eraser: 'Eraser: click and drag to erase to the background color.',
      fill: 'Fill: click a region to flood-fill it with the primary color.',
      eyedropper: 'Color Picker: click to pick a color from the canvas.',
      line: 'Line: drag to draw a straight line.',
      rect: 'Rectangle: drag to draw a rectangle.',
      ellipse: 'Ellipse: drag to draw an ellipse.',
      text: 'Text: click to place a text box, type, then click away to commit.',
    };
    document.getElementById('toolHint').textContent = hints[name] || '';
  }
  document.querySelectorAll('.tool').forEach(btn => btn.addEventListener('click', () => selectTool(btn.dataset.tool)));
  document.getElementById('fillModeRow').style.display = 'none';

  document.getElementById('sizeRange').addEventListener('input', (e) => {
    state.size = parseInt(e.target.value, 10);
    document.getElementById('sizeLabel').textContent = state.size;
  });
  document.getElementById('shapeMode').addEventListener('change', (e) => { state.shapeMode = e.target.value; });

  function setPrimary(hex) {
    state.primary = hex;
    document.getElementById('primarySwatch').style.background = hex;
    document.getElementById('colorPicker').value = hex;
  }
  function setSecondary(hex) {
    state.secondary = hex;
    document.getElementById('secondarySwatch').style.background = hex;
  }
  document.getElementById('colorPicker').addEventListener('input', (e) => setPrimary(e.target.value));
  document.getElementById('primarySwatch').addEventListener('click', () => document.getElementById('colorPicker').click());
  document.getElementById('secondarySwatch').addEventListener('click', () => setSecondary(state.primary));

  const PALETTE = [
    '#000000', '#7f7f7f', '#880015', '#ed1c24', '#ff7f27', '#fff200', '#22b14c', '#00a2e8', '#3f48cc', '#a349a4',
    '#ffffff', '#c3c3c3', '#b97a57', '#ffaec9', '#ffc90e', '#efe4b0', '#b5e61d', '#99d9ea', '#7092be', '#c8bfe7',
  ];
  const paletteEl = document.getElementById('palette');
  PALETTE.forEach(hex => {
    const sw = document.createElement('div');
    sw.className = 'p-swatch';
    sw.style.background = hex;
    sw.title = hex;
    sw.addEventListener('click', () => setPrimary(hex));
    sw.addEventListener('contextmenu', (e) => { e.preventDefault(); setSecondary(hex); });
    paletteEl.appendChild(sw);
  });
  setPrimary('#000000');
  setSecondary('#ffffff');

  document.getElementById('undoBtn').addEventListener('click', undo);
  document.getElementById('redoBtn').addEventListener('click', redo);

  // ---------- file operations ----------
  document.getElementById('saveBtn').addEventListener('click', () => {
    if (sel.active) commitSelection();
    const a = document.createElement('a');
    a.download = 'painting.png';
    a.href = mainCanvas.toDataURL('image/png');
    a.click();
  });

  function loadImageFromFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    if (sel.active) commitSelection();
    const img = new Image();
    img.onload = () => {
      setCanvasSize(img.width, img.height, false);
      mctx.clearRect(0, 0, img.width, img.height);
      mctx.drawImage(img, 0, 0);
      history.stack = []; history.index = -1;
      pushHistory();
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
  }

  document.getElementById('openBtn').addEventListener('click', () => document.getElementById('fileInput').click());
  document.getElementById('fileInput').addEventListener('change', (e) => {
    loadImageFromFile(e.target.files[0]);
    e.target.value = '';
  });

  const canvasArea = document.getElementById('canvasArea');
  ['dragenter', 'dragover'].forEach(evt => canvasArea.addEventListener(evt, (e) => {
    e.preventDefault();
    canvasArea.classList.add('drag-over');
  }));
  ['dragleave', 'drop'].forEach(evt => canvasArea.addEventListener(evt, (e) => {
    e.preventDefault();
    canvasArea.classList.remove('drag-over');
  }));
  canvasArea.addEventListener('drop', (e) => {
    loadImageFromFile(e.dataTransfer.files && e.dataTransfer.files[0]);
  });

  window.addEventListener('paste', (e) => {
    if (document.activeElement && document.activeElement.tagName === 'TEXTAREA') return;
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const item of items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        const img = new Image();
        img.onload = () => {
          const buf = document.createElement('canvas');
          buf.width = img.width; buf.height = img.height;
          buf.getContext('2d').drawImage(img, 0, 0);
          if (sel.active) commitSelection();
          selectTool('select');
          sel.active = true;
          sel.x = 0; sel.y = 0;
          sel.w = img.width; sel.h = img.height;
          sel.buffer = buf;
          sel.floating = true;
          sel.mode = 'idle';
          drawSelectionOverlay();
          URL.revokeObjectURL(img.src);
        };
        img.src = URL.createObjectURL(file);
        return;
      }
    }
  });

  document.getElementById('cropBtn').addEventListener('click', cropToSelection);
  document.getElementById('rotateCcwBtn').addEventListener('click', () => rotateCanvas(false));
  document.getElementById('rotateCwBtn').addEventListener('click', () => rotateCanvas(true));
  document.getElementById('flipHBtn').addEventListener('click', () => flipCanvas('h'));
  document.getElementById('flipVBtn').addEventListener('click', () => flipCanvas('v'));

  const resizeDialog = document.getElementById('resizeDialog');
  let resizeAspect = 1;
  document.getElementById('resizeBtn').addEventListener('click', () => {
    document.getElementById('resizeWidth').value = mainCanvas.width;
    document.getElementById('resizeHeight').value = mainCanvas.height;
    resizeAspect = mainCanvas.width / mainCanvas.height;
    resizeDialog.classList.remove('hidden');
  });
  document.getElementById('resizeCancel').addEventListener('click', () => resizeDialog.classList.add('hidden'));
  document.getElementById('resizeWidth').addEventListener('input', (e) => {
    if (!document.getElementById('resizeLockAspect').checked) return;
    const w = parseInt(e.target.value, 10);
    if (w > 0) document.getElementById('resizeHeight').value = Math.round(w / resizeAspect);
  });
  document.getElementById('resizeHeight').addEventListener('input', (e) => {
    if (!document.getElementById('resizeLockAspect').checked) return;
    const h = parseInt(e.target.value, 10);
    if (h > 0) document.getElementById('resizeWidth').value = Math.round(h * resizeAspect);
  });
  document.getElementById('resizeOk').addEventListener('click', () => {
    const w = Math.max(1, parseInt(document.getElementById('resizeWidth').value, 10) || mainCanvas.width);
    const h = Math.max(1, parseInt(document.getElementById('resizeHeight').value, 10) || mainCanvas.height);
    resizeImage(w, h);
    resizeDialog.classList.add('hidden');
  });

  const newDialog = document.getElementById('newDialog');
  document.getElementById('newBtn').addEventListener('click', () => {
    document.getElementById('newWidth').value = mainCanvas.width;
    document.getElementById('newHeight').value = mainCanvas.height;
    newDialog.classList.remove('hidden');
  });
  document.getElementById('newCancel').addEventListener('click', () => newDialog.classList.add('hidden'));
  document.getElementById('newOk').addEventListener('click', () => {
    const w = Math.max(1, parseInt(document.getElementById('newWidth').value, 10) || 800);
    const h = Math.max(1, parseInt(document.getElementById('newHeight').value, 10) || 600);
    setCanvasSize(w, h, true);
    history.stack = []; history.index = -1;
    pushHistory();
    newDialog.classList.add('hidden');
  });

  selectTool('select');
})();
