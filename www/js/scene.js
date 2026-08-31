/* 台账查找 - 三维场景（根据实拍照片建模：六个柜子、米灰/浅灰柜体、玻璃门） */
(function () {
  'use strict';

  /* ---------------- 尺寸常量 ---------------- */
  var CAB_W = 1.7, CAB_H = 2.6, CAB_D = 0.55;
  var CAB_GAP = 0.06;                      // 柜子之间缝隙（小一点）
  var CAM_FOV = 26;                        // 较小视场角：透视变形更小，柜子上下宽度一致
  var CAB_TOP = 2.6;
  var SIDE_T = 0.045;                      // 侧板厚
  var INNER_W = CAB_W - SIDE_T * 2;        // 双开柜内宽
  var BOX_D = 0.36, BOX_H = 0.50;
  var BAY_TOPS = [0.13, 0.87, 1.61];       // 每层搁板上表面
  var BOX_CENTERS = BAY_TOPS.map(function (t) { return t + BOX_H / 2; });
  var FRONT_Z = CAB_D / 2;                 // 柜前面
  var BACK_Z = -FRONT_Z + 0.02;

  /* 每层台账（档案盒）颜色：后台可自定义（红橙黄绿青蓝紫灰粉黑白棕），默认色 */
  var DEFAULT_COLORS = ['#E5484D', '#FF8A3D', '#F5C93C'];
  function boxColor(ci, si) {
    var cab = Store.data.cabinets[ci];
    var arr = (cab && cab.shelfColors && cab.shelfColors.length) ? cab.shelfColors : DEFAULT_COLORS;
    var hex = String(arr[si] || DEFAULT_COLORS[si % DEFAULT_COLORS.length]).replace('#', '');
    return parseInt(hex, 16);
  }
  var binderTexCache = {};
  function binderTexture(ci, si) {
    var key = ci + '-' + si;
    if (!binderTexCache[key]) binderTexCache[key] = makeBinderTexture(boxColor(ci, si));
    return binderTexCache[key];
  }

  /* 单开柜宽度为双开柜的一半，高度不变 */
  function cabDoorWidth(cab) {
    return (cab && cab.doorType === 'single') ? CAB_W * 0.5 : CAB_W;
  }
  function shelfUsableWidth(ci) {
    var cab = Store.data.cabinets[ci];
    return (cabDoorWidth(cab) - SIDE_T * 2) - 0.03;
  }
  var cabPositions = [];      // 每柜中心 x（已居中到 0）
  var rowHalf = 2.0;          // 整排柜子半宽
  function computeLayout() {
    cabPositions = [];
    var x = 0;
    Store.data.cabinets.forEach(function (c) {
      var w = cabDoorWidth(c);
      cabPositions.push(x + w / 2);
      x += w + CAB_GAP;
    });
    rowHalf = Math.max(1.5, (x - CAB_GAP) / 2);
    // 先按柜子边缘居中
    for (var i = 0; i < cabPositions.length; i++) cabPositions[i] -= rowHalf;
    // 再按“所有台账盒子”的实际左右边缘求内容中心，整体平移，保证视觉完全居中
    var left = Infinity, right = -Infinity;
    Store.data.cabinets.forEach(function (c, ci) {
      var uw = shelfUsableWidth(ci);
      c.shelves.forEach(function (shelf, si) {
        var n = shelf.length;
        if (!n) return;
        var w = uw / n;
        var x0 = cabPositions[ci] - uw / 2 + w * 0.5;
        var x1 = cabPositions[ci] - uw / 2 + w * (n - 0.5);
        if (x0 < left) left = x0;
        if (x1 > right) right = x1;
      });
    });
    var center = (left + right) / 2;
    for (var j = 0; j < cabPositions.length; j++) cabPositions[j] -= center;
    rowHalf -= center;
  }

  /* ---------------- 基础 ---------------- */
  var container, renderer, camera, controls, scene;
  var raycaster = new THREE.Raycaster();
  var pointerNdc = new THREE.Vector2();
  var boxes = {};        // key -> box record
  var boxMeshes = [];    // raycast targets
  var cabinetGroups = [];
  var hoverKey = null, markerKey = null, dimKey = null;
  var adminMode = false;
  var clock = new THREE.Clock();
  var tweens = [];
  var markerGroup = null, markerFrames = [];

  var onHoverCb = null, onClickCb = null, onFrameCb = null;

  function cabinetCount() { return (Store.data.cabinets && Store.data.cabinets.length) || 6; }
  function cabinetHalf() { return rowHalf; }

  /* ---------------- 缓动 ---------------- */
  function easeInOutCubic(t) { return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function easeOutBack(t) { var c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); }

  function addTween(dur, ease, onUpdate, onDone) {
    tweens.push({ t0: clock.elapsedTime, dur: dur, ease: ease, onUpdate: onUpdate, onDone: onDone });
  }

  function boxKey(ci, si, bi) { return ci + '-' + si + '-' + bi; }

  /* ---------------- 档案盒贴图 ---------------- */
  function makeBinderTexture(hex) {
    var c = document.createElement('canvas');
    c.width = 128; c.height = 256;
    var ctx = c.getContext('2d');
    var r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
    ctx.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
    ctx.fillRect(0, 0, 128, 256);
    // 顶部标签条
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(0, 0, 128, 46);
    ctx.fillStyle = 'rgba(0,0,0,0.10)';
    ctx.fillRect(0, 46, 128, 3);
    // 竖向书脊折痕
    var vg = ctx.createLinearGradient(0, 0, 128, 0);
    vg.addColorStop(0, 'rgba(0,0,0,0.16)');
    vg.addColorStop(0.5, 'rgba(255,255,255,0.06)');
    vg.addColorStop(1, 'rgba(0,0,0,0.18)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, 128, 256);
    var i;
    for (i = 0; i < 120; i++) {
      var x = Math.random() * 128, y = Math.random() * 256;
      ctx.fillStyle = 'rgba(' + Math.max(0, Math.min(255, r + (Math.random() - 0.5) * 18)) + ',' +
        Math.max(0, Math.min(255, g + (Math.random() - 0.5) * 18)) + ',' +
        Math.max(0, Math.min(255, b + (Math.random() - 0.5) * 18)) + ',0.06)';
      ctx.fillRect(x, y, 1, 1 + Math.random() * 2);
    }
    var tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.minFilter = THREE.LinearFilter;
    tex.encoding = THREE.sRGBEncoding;
    return tex;
  }

  /* ---------------- 木纹/柜体贴图（米灰柜） ---------------- */
  function makeWoodTexture(base, grain, grainAlpha, repeats) {
    var c = document.createElement('canvas');
    c.width = 256; c.height = 256;
    var ctx = c.getContext('2d');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, 256, 256);
    var vg = ctx.createLinearGradient(0, 0, 0, 256);
    vg.addColorStop(0, 'rgba(255,255,255,0.08)');
    vg.addColorStop(0.5, 'rgba(0,0,0,0.02)');
    vg.addColorStop(1, 'rgba(0,0,0,0.10)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, 256, 256);
    for (var i = 0; i < 58; i++) {
      var y = Math.random() * 256;
      var h = 0.8 + Math.random() * 2.4;
      ctx.strokeStyle = grain;
      ctx.globalAlpha = 0.04 + Math.random() * grainAlpha;
      ctx.lineWidth = h;
      ctx.beginPath();
      ctx.moveTo(-10, y);
      ctx.bezierCurveTo(64, y + (Math.random() * 8 - 4), 192, y + (Math.random() * 8 - 4), 266, y + (Math.random() * 5 - 2.5));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    var tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeats || 1, repeats || 1);
    tex.minFilter = THREE.LinearFilter;
    tex.encoding = THREE.sRGBEncoding;
    return tex;
  }

  /* ---------------- 材质（米灰/浅灰柜，优化质感） ---------------- */
  var matBody = new THREE.MeshLambertMaterial({ map: makeWoodTexture('#C2BBB2', '#A89F94', 0.08, 1) });
  var matBoard = new THREE.MeshLambertMaterial({ map: makeWoodTexture('#B6AEA4', '#9A9186', 0.10, 1) });
  var matBack = new THREE.MeshLambertMaterial({ map: makeWoodTexture('#AEA69C', '#928A7F', 0.10, 1) });
  var matPlinth = new THREE.MeshLambertMaterial({ map: makeWoodTexture('#9E968C', '#857D74', 0.10, 1) });
  var matDoor = new THREE.MeshLambertMaterial({ map: makeWoodTexture('#C9C2B9', '#ADA59B', 0.07, 1) });
  var matFrame = new THREE.MeshLambertMaterial({ map: makeWoodTexture('#ABA399', '#90887E', 0.10, 1) });
  var matHandle = new THREE.MeshPhongMaterial({ color: 0x7A746C, shininess: 80, specular: 0xBBBBBB });
  var matGlass = new THREE.MeshPhongMaterial({
    color: 0xd8e8f2, transparent: true, opacity: 0.10,
    shininess: 100, specular: 0x88aacc, depthWrite: false,
    reflectivity: 0.3
  });
  var matFloor = new THREE.MeshLambertMaterial({ color: 0xE8ECF2 });

  function roundedBox(w, h, d, mat, radius) {
    var geo = new THREE.RoundedBoxGeometry(w, h, d, 2, radius || 0.02);
    var m = new THREE.Mesh(geo, mat);
    m.castShadow = false; m.receiveShadow = false;
    return m;
  }

  /* ---------------- 标签贴图 ---------------- */
  function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function makeLabelTexture(text, code, aspect) {
    var cw = 256;
    var ch = Math.max(320, Math.min(1024, Math.round(cw * aspect)));
    var canvas = document.createElement('canvas');
    canvas.width = cw; canvas.height = ch;
    var ctx = canvas.getContext('2d');
    roundRectPath(ctx, 14, 18, cw - 28, ch - 36, 16);
    ctx.fillStyle = '#F8F2E2';
    ctx.fill();
    ctx.strokeStyle = 'rgba(150,128,92,0.5)';
    ctx.lineWidth = 5;
    ctx.stroke();

    var FONT_FAMILY = '"Microsoft YaHei", "PingFang SC", sans-serif';
    var padTop = 18, padBot = 18, padLR = 16;
    var top = padTop;

    // 文档编号：横向排列在名称上方（双重名称：编号 + 名称）
    var codeStr = code ? String(code).trim() : '';
    if (codeStr) {
      var numH = Math.max(46, Math.min(92, Math.round(ch * 0.16)));
      var maxW = cw - padLR * 2 - 8;
      var numFont = Math.floor(Math.min(cw * 0.46, numH * 0.66));
      ctx.font = 'bold ' + numFont + 'px ' + FONT_FAMILY;
      var mw = ctx.measureText(codeStr).width;
      if (mw > maxW) numFont = Math.max(13, Math.floor(numFont * maxW / mw));
      ctx.font = 'bold ' + numFont + 'px ' + FONT_FAMILY;
      // 编号标签底色块
      roundRectPath(ctx, padLR, padTop, cw - padLR * 2, numH, 12);
      ctx.fillStyle = 'rgba(90,74,44,0.09)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(90,74,44,0.30)';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = '#8A5A2C';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(codeStr, cw / 2, padTop + numH / 2 + 1);
      top = padTop + numH + 8;
      // 编号与名称之间的细分隔线
      ctx.strokeStyle = 'rgba(150,128,92,0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cw * 0.28, top - 4);
      ctx.lineTo(cw * 0.72, top - 4);
      ctx.stroke();
    }

    // 文档名称：竖向排列（保留原有风格）
    var len = Math.max(text.length, 1);
    var availH = ch - top - padBot;
    var font = Math.floor(Math.min(cw * 0.52, availH * 0.8 / len));
    var spacing = font * 1.18;
    var total = len * spacing - font * 0.18;
    var y0 = top + (availH - total) / 2;
    ctx.fillStyle = '#5A4A2C';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold ' + font + 'px ' + FONT_FAMILY;
    for (var i = 0; i < len; i++) {
      ctx.fillText(text.charAt(i), cw / 2, y0 + i * spacing + font / 2);
    }
    var tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    tex.encoding = THREE.sRGBEncoding;
    return tex;
  }

  function boxLabelMesh(rec) {
    var w = rec.dims.w * 0.86, h = rec.dims.h * 0.72;
    var label = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: makeLabelTexture(rec.name, rec.code, h / w), transparent: false })
    );
    label.position.z = rec.dims.d / 2 + 0.006;
    return label;
  }

  /* ---------------- 缩放时显示的台账名称 Sprite（已移除：名称仅保留在档案盒本体标签上） ---------------- */

  function makePlaqueTexture(text) {
    var canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 64;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#C5BEB5';
    ctx.fillRect(0, 0, 256, 64);
    ctx.strokeStyle = 'rgba(90,80,66,0.5)';
    ctx.lineWidth = 4;
    ctx.strokeRect(6, 6, 244, 52);
    ctx.fillStyle = '#4f483f';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 30px "Microsoft YaHei", "PingFang SC", sans-serif';
    ctx.fillText(text, 128, 34);
    var tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    tex.encoding = THREE.sRGBEncoding;
    return tex;
  }

  /* ---------------- 场景构建 ---------------- */
  function buildLights() {
    // 环境光：暖白 + 冷蓝双色调，更有层次
    scene.add(new THREE.HemisphereLight(0xf5f8ff, 0xe8ecf2, 0.7));
    // 主光：右上方暖色
    var key = new THREE.DirectionalLight(0xfff8ee, 1.1);
    key.position.set(5, 9, 7);
    scene.add(key);
    // 补光：左方冷色
    var fill = new THREE.DirectionalLight(0xe8f0ff, 0.5);
    fill.position.set(-5, 4, 8);
    scene.add(fill);
    // 轮廓光：后方冷白
    var rim = new THREE.DirectionalLight(0xffffff, 0.6);
    rim.position.set(0, 7, -6);
    scene.add(rim);
    // 底部微弱反光
    var bounce = new THREE.DirectionalLight(0xf0f4ff, 0.25);
    bounce.position.set(0, -2, 4);
    scene.add(bounce);
  }

  function buildBackdrop() {
    var c = document.createElement('canvas');
    c.width = 16; c.height = 512;
    var ctx = c.getContext('2d');
    var grad = ctx.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, '#f8faff');
    grad.addColorStop(0.4, '#f2f6fc');
    grad.addColorStop(0.75, '#edf1f8');
    grad.addColorStop(1, '#e6ebf4');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 16, 512);
    var tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    scene.background = tex;
    scene.fog = new THREE.Fog(0xf0f4fa, 12, 28);
  }

  function buildFloor() {
    var floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), matFloor);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.001;
    scene.add(floor);

    // 地面网格（微妙）
    var gridHelper = new THREE.GridHelper(40, 40, 0xd0d8e4, 0xe2e8f0);
    gridHelper.position.y = 0.003;
    gridHelper.material.transparent = true;
    gridHelper.material.opacity = 0.35;
    scene.add(gridHelper);

    var c = document.createElement('canvas');
    c.width = 512; c.height = 160;
    var ctx = c.getContext('2d');
    var grad = ctx.createRadialGradient(256, 70, 10, 256, 70, 280);
    grad.addColorStop(0, 'rgba(40,60,95,0.28)');
    grad.addColorStop(0.6, 'rgba(40,60,95,0.10)');
    grad.addColorStop(1, 'rgba(40,60,95,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 160);
    var st = new THREE.CanvasTexture(c);
    var shadowW = cabinetHalf() * 2 + 1.6;
    var shadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(shadowW, 1.8),
      new THREE.MeshBasicMaterial({ map: st, transparent: true, depthWrite: false })
    );
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.position.y = 0.004;
    shadowPlane.userData.isFloorShadow = true;
    scene.add(shadowPlane);
  }

  function clearCabinets() {
    cabinetGroups.forEach(function (g) {
      scene.remove(g);
      g.traverse(function (o) {
        if (o.geometry) o.geometry.dispose();
        // 材质与贴图为多个柜子共享，dispose 会破坏后续重建，因此只释放几何体
      });
    });
    cabinetGroups = [];
  }

  function buildCabinet(cx, cab) {
    var group = new THREE.Group();
    group.position.x = cx;
    scene.add(group);
    cabinetGroups.push(group);

    var w = cabDoorWidth(cab);            // 单开柜宽度为双开柜一半，高度不变
    var innerW = w - SIDE_T * 2;
    var hw = w / 2, hh = CAB_H / 2;
    var sx = hw - SIDE_T / 2;
    function addBox(bw, h, d, mat, x, y, z, radius) {
      var m = roundedBox(bw, h, d, mat, radius);
      m.position.set(x, y, z);
      group.add(m);
      return m;
    }

    // 侧板
    addBox(SIDE_T, CAB_H, CAB_D, matBody, -sx, hh, 0, 0.012);
    addBox(SIDE_T, CAB_H, CAB_D, matBody, sx, hh, 0, 0.012);

    // 背板
    var backH = 2.31 - 0.09;
    addBox(innerW, backH, 0.02, matBack, 0, 0.09 + backH / 2, BACK_Z, 0.006);

    // 底座
    addBox(innerW - 0.02, 0.09, CAB_D - 0.06, matPlinth, 0, 0.045, 0, 0.008);

    // 搁板（3层）
    [0.11, 0.85, 1.59].forEach(function (y) {
      addBox(w, 0.04, CAB_D, matBoard, 0, y, 0, 0.008);
    });

    // 顶板与冠线
    addBox(w, 0.16, CAB_D + 0.02, matBody, 0, 2.31 + 0.08, 0.01, 0.02);
    addBox(w + 0.02, 0.13, CAB_D + 0.04, matBoard, 0, 2.6 - 0.065, 0.012, 0.02);

    // 玻璃柜门 + 门框（对开/单开）
    addGlassFront(group, cab.doorType, innerW);

    // 柜号牌
    var plaque = new THREE.Mesh(
      new THREE.PlaneGeometry(0.3, 0.085),
      new THREE.MeshBasicMaterial({ map: makePlaqueTexture(cab.name), transparent: false })
    );
    plaque.position.set(0, 2.535, FRONT_Z + 0.03);
    group.add(plaque);
    return group;
  }

  function addGlassFront(group, doorType, glassW) {
    var z = FRONT_Z + 0.02;
    var yb = 0.14, yt = 2.29;
    var glassH = yt - yb;
    // 玻璃
    var glass = roundedBox(glassW, glassH, 0.015, matGlass, 0.005);
    glass.position.set(0, (yb + yt) / 2, z);
    group.add(glass);

    var t = 0.032, d = 0.02, zf = z + 0.008;
    function bar(w, h, x, y) {
      var m = roundedBox(w, h, d, matFrame, 0.008);
      m.position.set(x, y, zf);
      group.add(m);
    }
    bar(glassW, t, 0, yb);       // 下
    bar(glassW, t, 0, yt);       // 上
    bar(t, glassH, -glassW / 2, (yb + yt) / 2);
    bar(t, glassH, glassW / 2, (yb + yt) / 2);
    // 对开柜中间不再添加竖直分隔条，避免遮挡正中位置台账名称；玻璃门不再添加把手
  }

  /* ---------------- 档案盒 ---------------- */
  function boxDims(ci, si, count) {
    var w = shelfUsableWidth(ci) / count;
    return { w: w, h: BOX_H, d: BOX_D };
  }

  function boxCenterX(ci, bi, count) {
    var uw = shelfUsableWidth(ci);
    var w = uw / count;
    return cabPositions[ci] - uw / 2 + w * (bi + 0.5);
  }

  function createBoxMesh(key, ci, si, bi, name, code, count) {
    var dims = boxDims(ci, si, count);
    var mat = new THREE.MeshPhongMaterial({
      map: binderTexture(ci, si),
      shininess: 18,
      specular: 0x222222,
      transparent: true, opacity: 1
    });
    var mesh = roundedBox(dims.w, dims.h, dims.d, mat, 0.012);
    mesh.userData.key = key;
    mesh.userData.baseMat = mat;

    var group = new THREE.Group();
    group.add(mesh);
    group.add(boxLabelMesh({ dims: dims, name: name, code: code }));

    var x = boxCenterX(ci, bi, count);
    var rec = {
      key: key, ci: ci, si: si, bi: bi, name: name, code: code,
      group: group, mesh: mesh, mat: mat, color: boxColor(ci, si),
      basePos: new THREE.Vector3(x, BOX_CENTERS[si], FRONT_Z - dims.d / 2),
      dims: dims
    };
    group.position.copy(rec.basePos);
    return rec;
  }

  function ensureBoxes() {
    Store.data.cabinets.forEach(function (c, ci) {
      c.shelves.forEach(function (shelf, si) {
        var count = shelf.length;
        shelf.forEach(function (name, bi) {
          var key = boxKey(ci, si, bi);
          if (boxes[key]) return;
          var rec = createBoxMesh(key, ci, si, bi, name, Store.codeOf(ci, si, bi), count);
          boxes[key] = rec;
          scene.add(rec.group);
          boxMeshes.push(rec.mesh);
        });
      });
    });
  }

  function rebuildBoxMesh(key) {
    var rec = boxes[key];
    rec.name = Store.data.cabinets[rec.ci].shelves[rec.si][rec.bi];
    rec.code = Store.codeOf(rec.ci, rec.si, rec.bi);
    var dims = boxDims(rec.ci, rec.si, Store.data.cabinets[rec.ci].shelves[rec.si].length);
    rec.dims = dims;
    var cnt = Store.data.cabinets[rec.ci].shelves[rec.si].length;
    rec.basePos = new THREE.Vector3(
      boxCenterX(rec.ci, rec.bi, cnt),
      BOX_CENTERS[rec.si], FRONT_Z - dims.d / 2
    );

    var idx = boxMeshes.indexOf(rec.mesh);
    if (idx >= 0) boxMeshes.splice(idx, 1);
    rec.group.remove(rec.mesh);
    rec.mesh.geometry.dispose();
    rec.group.children.forEach(function (child) {
      rec.group.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (child.material.map) child.material.map.dispose();
        child.material.dispose();
      }
    });
    rec.mesh = roundedBox(dims.w, dims.h, dims.d, rec.mat, 0.012);
    rec.mesh.userData.key = rec.key;
    rec.group.add(rec.mesh);
    boxMeshes.push(rec.mesh);

    rec.group.add(boxLabelMesh(rec));
  }

  function animateLayout(animate) {
    Object.keys(boxes).forEach(function (key) { rebuildBoxMesh(key); });

    if (animate) {
      Object.keys(boxes).forEach(function (key, i) {
        var rec = boxes[key];
        rec.group.scale.setScalar(0.001);
        addTween(0.55 + Math.min(i * 0.008, 0.4), easeOutBack, function (k) {
          rec.group.scale.setScalar(Math.max(0.001, k));
        });
      });
      var starts = {};
      Object.keys(boxes).forEach(function (key) { starts[key] = boxes[key].group.position.clone(); });
      addTween(0.7, easeOutCubic, function (k) {
        Object.keys(boxes).forEach(function (key) {
          boxes[key].group.position.lerpVectors(starts[key], boxes[key].basePos, k);
        });
      });
    } else {
      Object.keys(boxes).forEach(function (key) {
        var rec = boxes[key];
        rec.group.position.copy(rec.basePos);
        rec.group.scale.setScalar(1);
      });
    }
  }

  function rebuildShelf(ci, si) {
    var shelf = Store.data.cabinets[ci].shelves[si];
    var count = shelf.length;
    var starts = {};
    shelf.forEach(function (name, bi) {
      var key = boxKey(ci, si, bi);
      if (!boxes[key]) {
        var rec = createBoxMesh(key, ci, si, bi, name, Store.codeOf(ci, si, bi), count);
        boxes[key] = rec;
        scene.add(rec.group);
        boxMeshes.push(rec.mesh);
        rec.group.scale.setScalar(0.001);
        addTween(0.5, easeOutBack, function (k) {
          rec.group.scale.setScalar(Math.max(0.001, k));
        });
      }
    });
    Object.keys(boxes).forEach(function (key) {
      var rec = boxes[key];
      if (rec.ci !== ci || rec.si !== si) return;
      if (rec.bi >= count) {
        var g = rec.group;
        addTween(0.25, easeOutCubic, function (k) {
          g.scale.setScalar(1 - k);
        }, function () {
          scene.remove(g);
          g.traverse(function (o) {
            if (o.geometry) o.geometry.dispose();
            if (o.material) {
              if (o.material.map) o.material.map.dispose();
              o.material.dispose();
            }
          });
          var idx = boxMeshes.indexOf(rec.mesh);
          if (idx >= 0) boxMeshes.splice(idx, 1);
          if (markerKey === key) clearMarker();
          delete boxes[key];
        });
      }
    });
    Object.keys(boxes).forEach(function (key) {
      var rec = boxes[key];
      if (rec.ci !== ci || rec.si !== si || rec.bi >= count) return;
      starts[key] = rec.group.position.clone();
      rebuildBoxMesh(key);
    });
    addTween(0.55, easeOutCubic, function (k) {
      Object.keys(boxes).forEach(function (key) {
        var rec = boxes[key];
        if (rec.ci !== ci || rec.si !== si || rec.bi >= count) return;
        if (starts[key]) rec.group.position.lerpVectors(starts[key], rec.basePos, k);
      });
    });
  }

  function refreshBoxLabel(key) {
    var rec = boxes[key];
    if (!rec) return;
    rec.name = Store.data.cabinets[rec.ci].shelves[rec.si][rec.bi];
    rec.code = Store.codeOf(rec.ci, rec.si, rec.bi);
    // 移除旧的标签和名称 sprite（保留 mesh，即第一个子对象）
    var toRemove = [];
    rec.group.children.forEach(function (child, i) {
      if (i > 0) toRemove.push(child);
    });
    toRemove.forEach(function (child) {
      rec.group.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (child.material.map) child.material.map.dispose();
        child.material.dispose();
      }
    });
    rec.group.add(boxLabelMesh(rec));
  }

  /* ---------------- 标记框 ---------------- */
  function clearMarker() {
    if (markerGroup) {
      scene.remove(markerGroup);
      markerGroup.traverse(function (o) {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
      markerGroup = null;
      markerFrames = [];
    }
    markerKey = null;
  }

  function showMarker(key) {
    clearMarker();
    var rec = boxes[key];
    if (!rec) return;
    markerKey = key;
    var d = rec.dims;
    markerGroup = new THREE.Group();
    var geos = [
      { s: 1.12, color: 0xFF7A2E, phase: 0, weight: 1 },
      { s: 1.24, color: 0xFFB070, phase: Math.PI / 2, weight: 2 }
    ];
    geos.forEach(function (spec) {
      var geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(d.w * spec.s, d.h * spec.s, d.d * spec.s));
      var mat = new THREE.LineBasicMaterial({ color: spec.color, transparent: true, opacity: 0.9 });
      var line = new THREE.LineSegments(geo, mat);
      line.userData = spec;
      markerGroup.add(line);
      markerFrames.push(line);
    });
    // 背后光晕面
    var glowGeo = new THREE.PlaneGeometry(d.w * 2.2, d.h * 2.2);
    var glowMat = new THREE.MeshBasicMaterial({
      color: 0xFF7A2E, transparent: true, opacity: 0.10,
      depthWrite: false, side: THREE.DoubleSide
    });
    var glow = new THREE.Mesh(glowGeo, glowMat);
    glow.position.z = -d.d / 2 - 0.02;
    glow.userData.isGlow = true;
    markerGroup.add(glow);
    markerFrames.push(glow);
    rec.group.add(markerGroup);
  }

  function updateMarker(t) {
    if (!markerGroup) return;
    markerFrames.forEach(function (obj) {
      if (obj.userData.isGlow) {
        var pulse = 0.5 + 0.5 * Math.sin(t * 4);
        obj.material.opacity = 0.06 + pulse * 0.12;
        var s = 1 + pulse * 0.15;
        obj.scale.set(s, s, 1);
      } else {
        var s = obj.userData.s;
        var pulse = 0.5 + 0.5 * Math.sin(t * 5 + obj.userData.phase);
        obj.scale.setScalar(1 + pulse * 0.05);
        obj.material.opacity = 0.4 + pulse * 0.55;
      }
    });
  }

  /* ---------------- 明暗 ---------------- */
  function setDimTarget(key) {
    dimKey = key;
    Object.keys(boxes).forEach(function (k) {
      var rec = boxes[k];
      var target = key === k;
      rec.mat.opacity = target ? 1 : 0.18;
      rec.mat.emissive.setHex(target ? 0x553311 : 0x000000);
      rec.mat.emissiveIntensity = target ? 0.4 : 0;
    });
  }

  function clearDim() {
    dimKey = null;
    Object.keys(boxes).forEach(function (k) {
      var rec = boxes[k];
      rec.mat.opacity = 1;
      rec.mat.emissive.setHex(0x000000);
      rec.mat.emissiveIntensity = 0;
      if (hoverKey !== k) rec.group.scale.setScalar(1);
    });
  }

  /* ---------------- 点击聚焦 ---------------- */
  var focusKey = null;

  function setFocusBox(key) {
    clearFocusBox();
    focusKey = key;
    var rec = boxes[key];
    if (!rec) return;
    if (hoverKey === key) hoverKey = null;
    Object.keys(boxes).forEach(function (k) {
      boxes[k].mat.opacity = k === key ? 1 : 0.4;
    });
    var startScale = rec.group.scale.x;
    var startPos = rec.group.position.clone();
    var endPos = rec.basePos.clone().add(new THREE.Vector3(0, 0.05, 0.09));
    addTween(0.3, easeOutCubic, function (k) {
      rec.group.scale.setScalar(startScale + (1.28 - startScale) * k);
      rec.group.position.lerpVectors(startPos, endPos, k);
    });
    rec.mat.emissive.setRGB(0.2, 0.2, 0.2);
  }

  function clearFocusBox() {
    var key = focusKey;
    focusKey = null;
    if (!key) return;
    var rec = boxes[key];
    Object.keys(boxes).forEach(function (k) {
      boxes[k].mat.opacity = 1;
    });
    if (rec) {
      var startScale = rec.group.scale.x;
      var startPos = rec.group.position.clone();
      addTween(0.3, easeOutCubic, function (k) {
        rec.group.scale.setScalar(startScale + (1 - startScale) * k);
        rec.group.position.lerpVectors(startPos, rec.basePos, k);
      });
      rec.mat.emissive.setRGB(0, 0, 0);
    }
  }

  /* ---------------- 相机 ---------------- */
  // 放大查看时拖拽=平移（往右移显示右侧架子、往左移显示左侧架子）；
  // 缩略总览时拖拽=旋转柜子，右键/双指可平移。
  var PAN_MODE_DIST = 3.5;   // 相机到目标距离小于此值视为“放大查看”
  var panModeOn = false;
  function panModeActive() {
    var d = camera ? camera.position.distanceTo(controls.target) : 99;
    return d < PAN_MODE_DIST;
  }
  function updateGestures() {
    var pan = panModeActive();
    if (pan === panModeOn) return;
    panModeOn = pan;
    if (pan) {
      // 放大查看：左键/单指平移，右键/双指旋转+缩放
      controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
      controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
      controls.touches.ONE = THREE.TOUCH.PAN;
      controls.touches.TWO = THREE.TOUCH.DOLLY_ROTATE;
    } else {
      // 缩略总览：左键/单指旋转，右键/双指缩放+平移
      controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
      controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
      controls.touches.ONE = THREE.TOUCH.ROTATE;
      controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
    }
  }
  // 平移边界：避免把整排柜子移出视野（按整排半宽限制，垂直方向也限位）
  function clampPan() {
    var t = controls.target;
    var lim = Math.max(rowHalf * 0.95, 1.6);
    t.x = Math.max(-lim, Math.min(lim, t.x));
    t.y = Math.max(0.35, Math.min(2.3, t.y));
  }

  function fitParams() {
    var aspect = camera ? camera.aspect : 16 / 10;
    var vHalf = Math.tan(THREE.MathUtils.degToRad(CAM_FOV) / 2);
    var hHalf = vHalf * aspect;
    var az = 0, el = 0.015;
    var ca = Math.cos(az), ce = Math.cos(el);
    var c = ca * ce, s = Math.sin(az) * ce;
    var margin = 0.4;
    var ty = overviewTarget().y;
    var dH = (cabinetHalf() + margin) / Math.max(c * hHalf - s, 0.05);
    var dVT = (CAB_TOP - ty + 0.15) / Math.max(ce * vHalf - Math.sin(el), 0.05);
    var dVB = (ty + 0.1) / (ce * vHalf + Math.sin(el));
    var dist = Math.max(dH, dVT, dVB);
    return Math.min(Math.max(dist, 4.2), 60);
  }

  function overviewTarget() {
    return new THREE.Vector3(0, adminMode ? 1.7 : 1.10, 0);
  }

  function flyToOverview(dur, done) {
    var dist = fitParams();
    var target = overviewTarget();
    var startPos = camera.position.clone();
    var startTarget = controls.target.clone();
    var az = 0, el = 0.015;
    var dir = new THREE.Vector3(
      Math.sin(az) * Math.cos(el),
      Math.sin(el),
      Math.cos(az) * Math.cos(el)
    );
    var endPos = target.clone().add(dir.multiplyScalar(dist));
    addTween(dur || 0.9, easeInOutCubic, function (k) {
      camera.position.lerpVectors(startPos, endPos, k);
      controls.target.lerpVectors(startTarget, target, k);
      controls.update();
    }, done || null);
  }

  function flyToBox(key, dur, done) {
    var rec = boxes[key];
    if (!rec) { if (done) done(); return; }
    var boxPos = new THREE.Vector3();
    rec.group.getWorldPosition(boxPos);

    var startPos = camera.position.clone();
    var startTarget = controls.target.clone();
    var dir = startPos.clone().sub(startTarget).normalize();
    var dist = 2.4; // 固定聚焦距离，保证每次点击/定位后画面大小一致，不会越点越大
    var endPos = boxPos.clone().add(new THREE.Vector3(0, 0.18, 0)).add(dir.clone().multiplyScalar(dist));
    if (endPos.y < 0.4) endPos.y = 0.4;
    var endTarget = boxPos.clone();

    addTween(dur || 1.15, easeInOutCubic, function (k) {
      camera.position.lerpVectors(startPos, endPos, k);
      controls.target.lerpVectors(startTarget, endTarget, k);
      controls.update();
    }, done || null);
  }

  /* ---------------- 拾取 ---------------- */
  function pick(event) {
    var rect = renderer.domElement.getBoundingClientRect();
    pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointerNdc, camera);
    var hits = raycaster.intersectObjects(boxMeshes, false);
    return hits.length ? hits[0].object.userData.key : null;
  }

  function project(key) {
    var rec = boxes[key];
    if (!rec) return null;
    var v = new THREE.Vector3(0, rec.dims.h * 0.7, 0);
    v.add(rec.group.position);
    v.project(camera);
    var rect = renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + (v.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (-v.y * 0.5 + 0.5) * rect.height,
      visible: v.z < 1
    };
  }

  /* ---------------- 主循环 ---------------- */
  function animate() {
    requestAnimationFrame(animate);
    var t = clock.getElapsedTime();
    clock.getDelta();
    if (tweens.length) {
      var remaining = [];
      for (var i = 0; i < tweens.length; i++) {
        var tw = tweens[i];
        var k = Math.min(1, (t - tw.t0) / tw.dur);
        var e = tw.ease(k);
        try { tw.onUpdate(e, k); } catch (err) { /* noop */ }
        if (k < 1) remaining.push(tw);
        else if (tw.onDone) { try { tw.onDone(); } catch (err) { /* noop */ } }
      }
      tweens = remaining;
    }
    updateMarker(t);
    controls.update();
    updateGestures();
    clampPan();
    renderer.render(scene, camera);
    if (onFrameCb) onFrameCb();
  }

  /* ---------------- 交互 ---------------- */
  var downPos = null, downKey = null, touchDismissTimer = null;
  var HOVER_SCALE = 1.22;

  function setHovered(key) {
    if (key === hoverKey) return;
    if (focusKey && key === focusKey) return;
    if (hoverKey) clearHovered();
    hoverKey = key;
    if (!key) return;
    var rec = boxes[key];
    if (!rec) return;
    var startScale = rec.group.scale.x;
    var startPos = rec.group.position.clone();
    var endPos = rec.basePos.clone().add(new THREE.Vector3(0, 0.045, 0.10));
    addTween(0.22, easeOutCubic, function (k) {
      rec.group.scale.setScalar(startScale + (HOVER_SCALE - startScale) * k);
      rec.group.position.lerpVectors(startPos, endPos, k);
    });
    if (dimKey !== key) rec.mat.emissive.setRGB(0.26, 0.26, 0.26);
  }

  function clearHovered() {
    var key = hoverKey;
    hoverKey = null;
    if (!key) return;
    if (key === focusKey) return;
    var rec = boxes[key];
    if (!rec) return;
    var startScale = rec.group.scale.x;
    var startPos = rec.group.position.clone();
    addTween(0.25, easeOutCubic, function (k) {
      rec.group.scale.setScalar(startScale + (1 - startScale) * k);
      rec.group.position.lerpVectors(startPos, rec.basePos, k);
    });
    rec.mat.emissive.setRGB(0, 0, 0);
  }

  function onPointerMove(e) {
    if (downPos) {
      var ddx = e.clientX - downPos.x, ddy = e.clientY - downPos.y;
      if (ddx * ddx + ddy * ddy > 64) {
        if (hoverKey) clearHovered();
        return;
      }
    }
    var key = pick(e);
    if (key === hoverKey) return;
    setHovered(key);
    if (onHoverCb) onHoverCb(hoverKey);
  }

  function onPointerLeave() {
    clearHovered();
    if (onHoverCb) onHoverCb(null);
  }

  function onPointerDown(e) {
    downPos = { x: e.clientX, y: e.clientY };
    downKey = pick(e);
    if (downKey) setHovered(downKey);
  }

  function onPointerUp(e) {
    if (!downPos) return;
    var dx = e.clientX - downPos.x, dy = e.clientY - downPos.y;
    downPos = null;
    var key = downKey;
    downKey = null;
    if (dx * dx + dy * dy > 36) return;
    if (key && onClickCb) onClickCb(key);
    if (e.pointerType === 'touch' && key) {
      if (touchDismissTimer) clearTimeout(touchDismissTimer);
      touchDismissTimer = setTimeout(function () { clearHovered(); }, 1600);
    }
  }

  /* ---------------- 对外接口 ---------------- */
  function buildCabinets() {
    computeLayout();
    clearCabinets();
    Store.data.cabinets.forEach(function (c, ci) {
      buildCabinet(cabPositions[ci], c);
    });
    buildFloorShadowWidth();
  }

  function buildFloorShadowWidth() {
    var shadowPlane = null;
    scene.children.forEach(function (o) {
      if (o.userData && o.userData.isFloorShadow) shadowPlane = o;
    });
    if (shadowPlane) {
      var shadowW = cabinetHalf() * 2 + 1.6;
      shadowPlane.geometry.dispose();
      shadowPlane.geometry = new THREE.PlaneGeometry(shadowW, 1.5);
    }
  }

  window.Scene3D = {
    init: function (el) {
      container = el;
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(CAM_FOV, el.clientWidth / el.clientHeight, 0.1, 100);
      camera.position.set(0, 1.7, 8);

      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
      // 平板/手机高 DPI 下 2x 渲染开销大，拖动会卡；上限 1.5x 明显更流畅（清晰度差异很小）
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.setSize(el.clientWidth, el.clientHeight);
      renderer.outputEncoding = THREE.sRGBEncoding;
      el.appendChild(renderer.domElement);

      controls = new THREE.OrbitControls(camera, renderer.domElement);
      controls.target.set(0, 1.12, 0);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      // 开启平移：放大查看时用拖拽平移柜子（而非转动柜子）
      controls.enablePan = true;
      controls.panSpeed = 0.6;
      // 启用双手捏合缩放：用户可双手放大查看台账，近距离时显示台账名称标签
      controls.enableZoom = true;
      controls.zoomSpeed = 0.8;
      controls.minDistance = 1.2;
      controls.maxDistance = 20;
      controls.minPolarAngle = 0.25;
      controls.maxPolarAngle = Math.PI / 2 - 0.15;
      controls.minAzimuthAngle = -0.9;
      controls.maxAzimuthAngle = 0.9;
      updateGestures();

      buildLights();
      buildBackdrop();
      buildFloor();

      renderer.domElement.addEventListener('pointermove', onPointerMove);
      renderer.domElement.addEventListener('pointerleave', onPointerLeave);
      renderer.domElement.addEventListener('pointerdown', onPointerDown);
      renderer.domElement.addEventListener('pointerup', onPointerUp);

      window.addEventListener('resize', this.resize);
      animate();
      this.resize();
      flyToOverview(1.4);

      // 若已有目录信息，则直接构建（例如已登录后重新打开）
      if (Store.data.cabinets && Store.data.cabinets.length) {
        buildCabinets();
        ensureBoxes();
      }
    },

    resize: function () {
      if (!renderer || !container) return;
      var w = container.clientWidth, h = container.clientHeight;
      if (!w || !h) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    },

    refit: function () { flyToOverview(0.7); },

    onBoxHover: function (cb) { onHoverCb = cb; },
    onBoxClick: function (cb) { onClickCb = cb; },
    onFrame: function (cb) { onFrameCb = cb; },

    setAdminMode: function (flag) {
      adminMode = flag;
      flyToOverview(0.6);
    },

    rebuildShelf: rebuildShelf,
    rebuildAll: function (animate) {
      buildCabinets();
      // 移除数据中已不存在的盒子
      Object.keys(boxes).forEach(function (key) {
        var rec = boxes[key];
        var count = Store.data.cabinets[rec.ci].shelves[rec.si].length;
        if (rec.bi >= count) {
          var g = rec.group;
          scene.remove(g);
          g.traverse(function (o) {
            if (o.geometry) o.geometry.dispose();
            if (o.material) {
              if (o.material.map) o.material.map.dispose();
              o.material.dispose();
            }
          });
          var idx = boxMeshes.indexOf(rec.mesh);
          if (idx >= 0) boxMeshes.splice(idx, 1);
          if (markerKey === key) clearMarker();
          delete boxes[key];
        }
      });
      ensureBoxes();
      animateLayout(!!animate);
      flyToOverview(0.7);
    },
    refreshBoxLabel: refreshBoxLabel,

    flyToBox: flyToBox,
    flyToOverview: flyToOverview,
    showMarker: showMarker,
    clearMarker: clearMarker,
    setDimTarget: setDimTarget,
    clearDim: clearDim,
    setFocusBox: setFocusBox,
    clearFocusBox: clearFocusBox,
    project: project,
    boxInfo: function (key) {
      var rec = boxes[key];
      return rec ? { ci: rec.ci, si: rec.si, bi: rec.bi, name: rec.name, code: rec.code } : null;
    },
    colorOf: function (ci) {
      var c = boxColor(ci, 0);
      return '#' + ('00000' + c.toString(16)).slice(-6);
    },
    debug: function () {
      return {
        boxCount: Object.keys(boxes).length,
        markerKey: markerKey,
        dimKey: dimKey,
        hoverKey: hoverKey,
        tweenCount: tweens.length,
        camera: camera ? {
          pos: camera.position.toArray(),
          target: controls ? controls.target.toArray() : null,
          aspect: camera.aspect,
          fov: camera.fov
        } : null,
        projectWorld: function (x, y, z) {
          var v = new THREE.Vector3(x, y, z).project(camera);
          return { x: v.x, y: v.y };
        },
        boxWorld: function (key) {
          return boxes[key] ? boxes[key].group.position.toArray() : null;
        },
        hoverScale: hoverKey && boxes[hoverKey] ? boxes[hoverKey].group.scale.x : null,
        focusKey: focusKey,
        focusScale: focusKey && boxes[focusKey] ? boxes[focusKey].group.scale.x : null,
        cabinetCount: cabinetCount()
      };
    },
    currentHover: function () { return hoverKey; }
  };
})();
