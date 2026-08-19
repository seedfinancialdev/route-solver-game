/**
 * 2D Canvas Camera & Viewport Projection Controller
 * Provides 60fps pan/zoom physics, inertia, bounds constraints, and coordinate transforms.
 */

export class Camera {
  constructor(container, worldBounds) {
    this.container = container;
    this.worldBounds = worldBounds; // { x, y, w, h } in km map coordinates

    // Camera state (world units visible in viewport)
    this.target = { x: worldBounds.x, y: worldBounds.y, w: worldBounds.w, h: worldBounds.h };
    this.current = { ...this.target };

    // Aspect ratio & viewport size in CSS pixels
    this.viewportWidth = container.clientWidth || 800;
    this.viewportHeight = container.clientHeight || 600;

    // Interaction state
    this.isDragging = false;
    this.dragStart = { x: 0, y: 0 };
    this.velocity = { x: 0, y: 0 };

    this.minZoomKm = 3.0; // close city street zoom (3 km across)
    this.maxZoomKm = worldBounds.w * 1.2; // continent view

    this.initEvents();
  }

  resize(width, height) {
    this.viewportWidth = width;
    this.viewportHeight = height;
    this.updateAspectRatio();
  }

  updateAspectRatio() {
    if (!this.viewportWidth || !this.viewportHeight) return;
    const aspect = this.viewportWidth / this.viewportHeight;
    const currentAspect = this.target.w / this.target.h;

    if (currentAspect < aspect) {
      const newW = this.target.h * aspect;
      this.target.x -= (newW - this.target.w) / 2;
      this.target.w = newW;
    } else {
      const newH = this.target.w / aspect;
      this.target.y -= (newH - this.target.h) / 2;
      this.target.h = newH;
    }
  }

  setFrame(x, y, w) {
    const aspect = this.viewportWidth / this.viewportHeight;
    const h = w / aspect;
    this.target = { x: x - w / 2, y: y - h / 2, w, h };
    this.clampTarget();
  }

  zoomAt(screenX, screenY, factor) {
    const worldCenter = this.screenToWorld(screenX, screenY);
    const newW = Math.min(Math.max(this.target.w * factor, this.minZoomKm), this.maxZoomKm);
    const aspect = this.viewportWidth / this.viewportHeight;
    const newH = newW / aspect;

    // Keep point under cursor stationary
    const ratioX = screenX / this.viewportWidth;
    const ratioY = screenY / this.viewportHeight;

    this.target.w = newW;
    this.target.h = newH;
    this.target.x = worldCenter.x - ratioX * newW;
    this.target.y = worldCenter.y - ratioY * newH;

    this.clampTarget();
  }

  pan(deltaScreenX, deltaScreenY) {
    const worldDx = (deltaScreenX / this.viewportWidth) * this.current.w;
    const worldDy = (deltaScreenY / this.viewportHeight) * this.current.h;

    this.target.x -= worldDx;
    this.target.y -= worldDy;
    this.clampTarget();
  }

  clampTarget() {
    const SLACK = 800;
    const minX = this.worldBounds.x - SLACK;
    const maxX = this.worldBounds.x + this.worldBounds.w + SLACK - this.target.w;
    const minY = this.worldBounds.y - SLACK;
    const maxY = this.worldBounds.y + this.worldBounds.h + SLACK - this.target.h;

    this.target.x = Math.min(Math.max(this.target.x, minX), maxX);
    this.target.y = Math.min(Math.max(this.target.y, minY), maxY);
  }

  update(dt = 0.016) {
    // Smooth interpolation towards target (lerp)
    const lerpFactor = 0.2;
    this.current.x += (this.target.x - this.current.x) * lerpFactor;
    this.current.y += (this.target.y - this.current.y) * lerpFactor;
    this.current.w += (this.target.w - this.current.w) * lerpFactor;
    this.current.h += (this.target.h - this.current.h) * lerpFactor;
  }

  worldToScreen(worldX, worldY) {
    const screenX = ((worldX - this.current.x) / this.current.w) * this.viewportWidth;
    const screenY = ((worldY - this.current.y) / this.current.h) * this.viewportHeight;
    return { x: screenX, y: screenY };
  }

  screenToWorld(screenX, screenY) {
    const worldX = this.current.x + (screenX / this.viewportWidth) * this.current.w;
    const worldY = this.current.y + (screenY / this.viewportHeight) * this.current.h;
    return { x: worldX, y: worldY };
  }

  initEvents() {
    const el = this.container;

    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY > 0 ? 1.15 : 0.85;
      this.zoomAt(e.clientX, e.clientY, zoomFactor);
    }, { passive: false });

    el.addEventListener('mousedown', (e) => {
      this.isDragging = true;
      this.dragStart = { x: e.clientX, y: e.clientY };
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isDragging) return;
      const dx = e.clientX - this.dragStart.x;
      const dy = e.clientY - this.dragStart.y;
      this.dragStart = { x: e.clientX, y: e.clientY };
      this.pan(dx, dy);
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
    });

    el.addEventListener('dblclick', (e) => {
      this.zoomAt(e.clientX, e.clientY, 0.5);
    });
  }
}
