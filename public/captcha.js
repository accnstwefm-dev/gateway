/**
 * Guard Slider CAPTCHA Controller
 * Defensive Human-Interaction Verification Client
 */
class SliderCaptcha {
  constructor(options = {}) {
    this.containerId = options.containerId || 'captcha-container';
    this.apiBase = options.apiBase || '/api/captcha';
    this.onSuccess = options.onSuccess || (() => {});
    this.onError = options.onError || (() => {});

    this.container = document.getElementById(this.containerId);
    if (!this.container) {
      console.error(`SliderCaptcha: Container #${this.containerId} not found.`);
      return;
    }

    this.challengeToken = null;
    this.targetY = 0;
    this.canvasWidth = 340;
    this.canvasHeight = 180;
    this.pieceSize = 44;

    this.isDragging = false;
    this.startX = 0;
    this.currentX = 0;
    this.maxTravel = 0;
    this.trail = [];
    this.isVerified = false;
    this.isLoading = false;

    this.initDOM();
    this.bindEvents();
    this.loadChallenge();
  }

  initDOM() {
    this.container.innerHTML = `
      <div class="captcha-box">
        <div class="captcha-stage">
          <img class="captcha-bg-img" alt="Captcha Background" />
          <img class="captcha-piece-img" alt="Puzzle Piece" />
          <div class="captcha-loading-overlay">
            <div class="captcha-spinner"></div>
            <span style="font-size:12px;color:#9ca3af;">Securing challenge...</span>
          </div>
        </div>

        <div class="slider-track">
          <div class="slider-progress"></div>
          <span class="slider-hint-text">Slide to complete the puzzle</span>
          <div class="slider-handle" tabindex="0" role="slider" aria-label="Slider CAPTCHA handle">
            <svg class="handle-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          </div>
        </div>

        <div class="captcha-controls">
          <button type="button" class="refresh-btn">
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
          <div class="captcha-status-msg"></div>
        </div>
      </div>
    `;

    this.bgImg = this.container.querySelector('.captcha-bg-img');
    this.pieceImg = this.container.querySelector('.captcha-piece-img');
    this.loadingOverlay = this.container.querySelector('.captcha-loading-overlay');
    this.track = this.container.querySelector('.slider-track');
    this.progress = this.container.querySelector('.slider-progress');
    this.handle = this.container.querySelector('.slider-handle');
    this.hintText = this.container.querySelector('.slider-hint-text');
    this.refreshBtn = this.container.querySelector('.refresh-btn');
    this.statusMsg = this.container.querySelector('.captcha-status-msg');
    this.handleIcon = this.container.querySelector('.handle-icon');
  }

  bindEvents() {
    this.refreshBtn.addEventListener('click', () => this.loadChallenge());

    // Mouse events
    this.handle.addEventListener('mousedown', (e) => this.startDrag(e.clientX, e.clientY));
    window.addEventListener('mousemove', (e) => this.onDrag(e.clientX, e.clientY));
    window.addEventListener('mouseup', () => this.endDrag());

    // Touch events for mobile
    this.handle.addEventListener('touchstart', (e) => {
      const touch = e.touches[0];
      this.startDrag(touch.clientX, touch.clientY);
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
      if (!this.isDragging) return;
      const touch = e.touches[0];
      this.onDrag(touch.clientX, touch.clientY);
    }, { passive: false });

    window.addEventListener('touchend', () => this.endDrag());
  }

  async loadChallenge() {
    if (this.isLoading) return;
    this.isLoading = true;
    this.isVerified = false;
    this.resetSliderVisuals();
    this.loadingOverlay.style.display = 'flex';
    this.loadingOverlay.style.opacity = '1';
    this.statusMsg.textContent = '';
    this.statusMsg.className = 'captcha-status-msg';

    try {
      const res = await fetch(`${this.apiBase}/create`);
      if (!res.ok) {
        throw new Error('Failed to load challenge');
      }
      const data = await res.json();
      
      this.challengeToken = data.challengeToken;
      this.targetY = data.targetY;
      this.canvasWidth = data.canvasWidth || 340;
      this.canvasHeight = data.canvasHeight || 180;
      this.pieceSize = data.pieceSize || 44;

      // Track travel distance is track width (340) minus handle width (44)
      this.maxTravel = this.canvasWidth - this.pieceSize;

      // Set images
      this.bgImg.src = data.bgImage;
      this.pieceImg.src = data.pieceImage;
      this.pieceImg.style.top = `${this.targetY}px`;
      this.pieceImg.style.left = '0px';

      // Hide loader once image loads
      this.bgImg.onload = () => {
        this.loadingOverlay.style.opacity = '0';
        setTimeout(() => {
          this.loadingOverlay.style.display = 'none';
          this.isLoading = false;
        }, 200);
      };
    } catch (err) {
      this.statusMsg.textContent = 'Failed to load CAPTCHA';
      this.statusMsg.className = 'captcha-status-msg error';
      this.isLoading = false;
    }
  }

  startDrag(clientX, clientY) {
    if (this.isVerified || this.isLoading) return;
    this.isDragging = true;
    this.startX = clientX;
    this.currentX = 0;
    this.trail = [{ x: clientX, y: clientY, t: Date.now() }];
    this.hintText.style.opacity = '0';
    this.statusMsg.textContent = '';
  }

  onDrag(clientX, clientY) {
    if (!this.isDragging) return;

    let deltaX = clientX - this.startX;
    if (deltaX < 0) deltaX = 0;
    if (deltaX > this.maxTravel) deltaX = this.maxTravel;

    this.currentX = deltaX;
    this.trail.push({ x: clientX, y: clientY, t: Date.now() });

    // Update slider position
    this.handle.style.transform = `translate(${deltaX}px, 0)`;
    this.progress.style.width = `${deltaX + 22}px`;

    // Move piece on stage
    this.pieceImg.style.left = `${deltaX}px`;
  }

  async endDrag() {
    if (!this.isDragging) return;
    this.isDragging = false;

    if (this.currentX === 0) {
      this.hintText.style.opacity = '1';
      return;
    }

    const finalX = this.currentX;
    this.loadingOverlay.style.display = 'flex';
    this.loadingOverlay.style.opacity = '0.7';

    try {
      const res = await fetch(`${this.apiBase}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challengeToken: this.challengeToken,
          userX: Math.round(finalX),
          trail: this.trail
        })
      });

      const result = await res.json();
      this.loadingOverlay.style.display = 'none';

      if (res.ok && result.success) {
        this.handleSuccess(result);
      } else {
        this.handleFailure(result.message || 'Verification failed');
      }
    } catch (err) {
      this.loadingOverlay.style.display = 'none';
      this.handleFailure('Network error during verification');
    }
  }

  handleSuccess(result) {
    this.isVerified = true;
    this.track.classList.add('success');
    this.statusMsg.textContent = 'Verified Human';
    this.statusMsg.className = 'captcha-status-msg success';

    // Set checkmark in handle
    this.handleIcon.innerHTML = `
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" />
    `;

    this.onSuccess(result);
  }

  handleFailure(message) {
    this.track.classList.add('failed');
    this.statusMsg.textContent = message;
    this.statusMsg.className = 'captcha-status-msg error';

    // Shake animation feedback
    setTimeout(() => {
      this.loadChallenge();
    }, 1200);

    this.onError({ message });
  }

  resetSliderVisuals() {
    this.handle.style.transform = 'translate(0px, 0)';
    this.progress.style.width = '0%';
    this.pieceImg.style.left = '0px';
    this.track.className = 'slider-track';
    this.hintText.style.opacity = '1';
    this.handleIcon.innerHTML = `
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M14 5l7 7m0 0l-7 7m7-7H3" />
    `;
  }
}

// Export as global
window.SliderCaptcha = SliderCaptcha;
