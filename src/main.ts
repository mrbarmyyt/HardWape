/**
 * HandDraw - Веб-приложение для рисования жестами через веб-камеру
 * с расширенной биомеханической системой распознавания 7 жестов рук на MediaPipe Hands
 * и отслеживанием всех 21 суставов кисти от ладони к пальцам.
 *
 * ЖЕСТЫ:
 * 1. ☝️ Указательный палец — Курсор (наведение на холст и кнопки)
 * 2. 🤏 Большой + Указательный — Рисование (или нажатие кнопки)
 * 3. ✊ Кулак — Перемещение рисунка по холсту (с защитой от скачков и стрелкой скорости)
 * 4. ✌️ Два пальца — Плавное масштабирование рисунка (Zoom)
 * 5. 🖐️ Открытая ладонь — Ожидание / Стоп (пауза)
 * 6. 👌 Жест «OK» — Выбор / Подтверждение инструмента
 * 7. 🖕 Средний палец — Отмена последнего действия (Undo с cooldown)
 */
import './index.css';
import confetti from 'canvas-confetti';

interface Point {
  x: number;
  y: number;
}

export type BrushStyle = 'solid' | 'neon' | 'rainbow' | 'sparkle';

export interface StrokePoint extends Point {
  hue?: number;
}

interface Stroke {
  points: StrokePoint[];
  color: string;
  size: number;
  isEraser: boolean;
  style: BrushStyle;
}

// Synthesized audio feedback engine using Web Audio API
class SoundEffects {
  private ctx: AudioContext | null = null;
  public enabled = true;

  private initCtx(): AudioContext | null {
    if (!this.enabled) return null;
    try {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          this.ctx = new AudioCtx();
        }
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      return this.ctx;
    } catch {
      return null;
    }
  }

  public playPop(): void {
    const ctx = this.initCtx();
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      const now = ctx.currentTime;
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(720, now + 0.05);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.06);
    } catch {}
  }

  public playWhoosh(): void {
    const ctx = this.initCtx();
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      const now = ctx.currentTime;
      osc.frequency.setValueAtTime(280, now);
      osc.frequency.exponentialRampToValueAtTime(140, now + 0.09);
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.09);
    } catch {}
  }

  public playUndo(): void {
    const ctx = this.initCtx();
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      const now = ctx.currentTime;
      osc.frequency.setValueAtTime(520, now);
      osc.frequency.exponentialRampToValueAtTime(320, now + 0.14);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.14);
    } catch {}
  }

  public playRedo(): void {
    const ctx = this.initCtx();
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      const now = ctx.currentTime;
      osc.frequency.setValueAtTime(320, now);
      osc.frequency.exponentialRampToValueAtTime(560, now + 0.14);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.14);
    } catch {}
  }

  public playClear(): void {
    const ctx = this.initCtx();
    if (!ctx) return;
    try {
      const freqs = [440, 554, 659, 880];
      const now = ctx.currentTime;
      freqs.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        const start = now + idx * 0.035;
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.08, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.18);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.18);
      });
    } catch {}
  }
}

// MediaPipe Landmark types
interface Landmark {
  x: number;
  y: number;
  z: number;
}

interface HandsResults {
  multiHandLandmarks?: Landmark[][];
  multiHandedness?: { label: string; score: number }[];
  image: any;
}

// Finger state types
type FingerState = 'extended' | 'folded' | 'partial';

interface FingerStates {
  thumb: FingerState;
  index: FingerState;
  middle: FingerState;
  ring: FingerState;
  pinky: FingerState;
}

// Supported gesture modes
type GestureType =
  | 'cursor' // ☝️
  | 'draw' // 🤏
  | 'move' // ✊
  | 'zoom' // ✌️
  | 'wait' // 🖐️
  | 'ok' // 👌
  | 'undo' // 🖕
  | 'none';

class HandDrawApp {
  // Audio Engine
  private soundFx = new SoundEffects();

  // DOM Elements
  private video: HTMLVideoElement;
  private drawingCanvas: HTMLCanvasElement;
  private cursorCanvas: HTMLCanvasElement;
  private drawingCtx: CanvasRenderingContext2D;
  private cursorCtx: CanvasRenderingContext2D;

  private welcomeModal: HTMLElement;
  private btnStartHero: HTMLButtonElement;
  private btnToggleCamera: HTMLButtonElement;
  private btnCameraText: HTMLElement;
  private cameraIconOn: SVGElement;
  private cameraIconOff: SVGElement;
  private cameraErrorBox: HTMLElement;
  private cameraErrorMessage: HTMLElement;

  private toolbar: HTMLElement;
  private btnHideToolbar: HTMLButtonElement;
  private btnShowToolbar: HTMLButtonElement;
  private btnEraser: HTMLButtonElement;
  private btnClear: HTMLButtonElement;
  private btnUndo: HTMLButtonElement;
  private btnRedo: HTMLButtonElement;
  private btnResetView: HTMLButtonElement;
  private btnQuickResetView: HTMLButtonElement;
  private viewIndicator: HTMLElement;
  private viewZoomText: HTMLElement;
  private btnSave: HTMLButtonElement;
  private btnFullscreen: HTMLButtonElement;
  private btnMirrorToggle: HTMLButtonElement;
  private btnToggleHud: HTMLButtonElement;

  // Header quick controls
  private btnBgMode: HTMLButtonElement;
  private bgModeIcon: HTMLElement;
  private btnSoundToggle: HTMLButtonElement;
  private soundIcon: HTMLElement;
  private btnHelpGuide: HTMLButtonElement;

  // Modals
  private saveModal: HTMLElement;
  private btnCloseSaveModal: HTMLButtonElement;
  private btnSaveBlack: HTMLButtonElement;
  private btnSaveTransparent: HTMLButtonElement;
  private btnSavePhoto: HTMLButtonElement;
  private cheatsheetModal: HTMLElement;
  private btnCloseCheatsheet: HTMLButtonElement;

  // Bottom Status
  private statusDot: HTMLElement;
  private statusText: HTMLElement;
  private statusHint: HTMLElement;
  private gestureBadge: HTMLElement;
  private gestureBadgeEmoji: HTMLElement;
  private gestureBadgeTitle: HTMLElement;

  // Telemetry HUD Elements
  private handHudPanel: HTMLElement;
  private hudHandedness: HTMLElement;
  private hudConfidenceVal: HTMLElement;
  private hudConfidenceFill: HTMLElement;
  private fStateThumb: HTMLElement;
  private fStateIndex: HTMLElement;
  private fStateMiddle: HTMLElement;
  private fStateRing: HTMLElement;
  private fStatePinky: HTMLElement;
  private hudGestureLabel: HTMLElement;

  // Camera & Stream
  private mediaStream: MediaStream | null = null;
  private isCameraActive = false;
  private isMirrored = true;
  private backgroundMode: 'black' | 'dimmed' | 'camera' = 'dimmed';
  private hands: any = null;
  private isProcessingFrame = false;
  private animationFrameId: number | null = null;

  // World transform (Pan & Zoom)
  private panOffsetX = 0;
  private panOffsetY = 0;
  private zoomScale = 1.0;

  // Drawing settings
  private currentColor = '#ffffff';
  private brushSize = 5;
  private isEraserActive = false;
  private currentBrushStyle: BrushStyle = 'solid';
  private rainbowHue = 0;

  // Stroke vector history and Redo stack
  private strokes: Stroke[] = [];
  private redoStack: Stroke[] = [];
  private currentStroke: Stroke | null = null;
  private undoSnapshot: Stroke[] | null = null;

  // Air Dwell-Click State
  private hoverStartTime = 0;
  private readonly DWELL_CLICK_TIME_MS = 720;
  private dwellProgress = 0;

  // Smoothed all 21 hand landmarks (2D screen pixels)
  private isHandDetected = false;
  private targetLandmarks: Point[] = [];
  private smoothLandmarks: Point[] = [];
  private rawLandmarks: Landmark[] = [];

  // Palm center
  private targetPalmCenter: Point = { x: 0, y: 0 };
  private smoothPalmCenter: Point = { x: 0, y: 0 };

  // Biomechanical finger analysis
  private fingerStates: FingerStates = {
    thumb: 'folded',
    index: 'folded',
    middle: 'folded',
    ring: 'folded',
    pinky: 'folded',
  };
  private handConfidence = 0;
  private handSideLabel = 'Ожидание...';

  // Gesture state & hysteresis
  private currentGesture: GestureType = 'none';
  private pendingGesture: GestureType = 'none';
  private pendingGestureFrames = 0;

  // Gesture interaction parameters
  private isDrawing = false;

  // Pan (✊ Fist) parameters with jump protection
  private isPanning = false;
  private panActive = false;
  private panStartScreenX = 0;
  private panStartScreenY = 0;
  private panBaseOffsetX = 0;
  private panBaseOffsetY = 0;

  // Movement velocity & Direction arrow
  private prevPalmX = 0;
  private prevPalmY = 0;
  private handVelX = 0;
  private handVelY = 0;
  private handSpeed = 0;

  // Zoom (✌️ Two Fingers)
  private isZooming = false;
  private zoomStartDist = 0;
  private zoomBaseScale = 1.0;
  private zoomCenterX = 0;
  private zoomCenterY = 0;
  private zoomWorldCenterX = 0;
  private zoomWorldCenterY = 0;

  // Cooldowns
  private lastUndoTime = 0;
  private readonly UNDO_COOLDOWN_MS = 1000;
  private lastHandClickTime = 0;
  private readonly HAND_CLICK_COOLDOWN_MS = 500;

  // Hand hover target
  private hoveredElement: HTMLElement | null = null;

  // Mouse / Touch fallback drawing
  private isMouseDown = false;

  constructor() {
    // Canvas & Video
    this.video = document.getElementById('webcam-video') as HTMLVideoElement;
    this.drawingCanvas = document.getElementById('drawing-canvas') as HTMLCanvasElement;
    this.cursorCanvas = document.getElementById('cursor-canvas') as HTMLCanvasElement;

    this.drawingCtx = this.drawingCanvas.getContext('2d')!;
    this.cursorCtx = this.cursorCanvas.getContext('2d')!;

    // UI elements
    this.welcomeModal = document.getElementById('welcome-modal')!;
    this.btnStartHero = document.getElementById('btn-start-camera-hero') as HTMLButtonElement;
    this.btnToggleCamera = document.getElementById('btn-toggle-camera') as HTMLButtonElement;
    this.btnCameraText = document.getElementById('btn-camera-text')!;
    this.cameraIconOn = document.querySelector('.camera-icon-on') as SVGElement;
    this.cameraIconOff = document.querySelector('.camera-icon-off') as SVGElement;
    this.cameraErrorBox = document.getElementById('camera-error-box')!;
    this.cameraErrorMessage = document.getElementById('camera-error-message')!;

    this.toolbar = document.getElementById('toolbar')!;
    this.btnHideToolbar = document.getElementById('btn-hide-toolbar') as HTMLButtonElement;
    this.btnShowToolbar = document.getElementById('btn-show-toolbar') as HTMLButtonElement;
    this.btnEraser = document.getElementById('btn-eraser') as HTMLButtonElement;
    this.btnClear = document.getElementById('btn-clear') as HTMLButtonElement;
    this.btnUndo = document.getElementById('btn-undo') as HTMLButtonElement;
    this.btnRedo = document.getElementById('btn-redo') as HTMLButtonElement;
    this.btnResetView = document.getElementById('btn-reset-view') as HTMLButtonElement;
    this.btnQuickResetView = document.getElementById('btn-quick-reset-view') as HTMLButtonElement;
    this.viewIndicator = document.getElementById('view-indicator')!;
    this.viewZoomText = document.getElementById('view-zoom-text')!;
    this.btnSave = document.getElementById('btn-save') as HTMLButtonElement;
    this.btnFullscreen = document.getElementById('btn-fullscreen') as HTMLButtonElement;
    this.btnMirrorToggle = document.getElementById('btn-mirror-toggle') as HTMLButtonElement;
    this.btnToggleHud = document.getElementById('btn-toggle-hud') as HTMLButtonElement;

    // Header controls
    this.btnBgMode = document.getElementById('btn-bg-mode') as HTMLButtonElement;
    this.bgModeIcon = document.getElementById('bg-mode-icon')!;
    this.btnSoundToggle = document.getElementById('btn-sound-toggle') as HTMLButtonElement;
    this.soundIcon = document.getElementById('sound-icon')!;
    this.btnHelpGuide = document.getElementById('btn-help-guide') as HTMLButtonElement;

    // Modals
    this.saveModal = document.getElementById('save-modal')!;
    this.btnCloseSaveModal = document.getElementById('btn-close-save-modal') as HTMLButtonElement;
    this.btnSaveBlack = document.getElementById('btn-save-black') as HTMLButtonElement;
    this.btnSaveTransparent = document.getElementById('btn-save-transparent') as HTMLButtonElement;
    this.btnSavePhoto = document.getElementById('btn-save-photo') as HTMLButtonElement;
    this.cheatsheetModal = document.getElementById('cheatsheet-modal')!;
    this.btnCloseCheatsheet = document.getElementById('btn-close-cheatsheet') as HTMLButtonElement;

    // Status pill
    this.statusDot = document.getElementById('status-dot')!;
    this.statusText = document.getElementById('status-text')!;
    this.statusHint = document.getElementById('status-hint')!;
    this.gestureBadge = document.getElementById('gesture-badge')!;
    this.gestureBadgeEmoji = document.getElementById('gesture-badge-emoji')!;
    this.gestureBadgeTitle = document.getElementById('gesture-badge-title')!;

    // HUD Telemetry
    this.handHudPanel = document.getElementById('hand-hud')!;
    this.hudHandedness = document.getElementById('hud-handedness')!;
    this.hudConfidenceVal = document.getElementById('hud-confidence-val')!;
    this.hudConfidenceFill = document.getElementById('hud-confidence-fill')!;
    this.fStateThumb = document.getElementById('f-state-thumb')!;
    this.fStateIndex = document.getElementById('f-state-index')!;
    this.fStateMiddle = document.getElementById('f-state-middle')!;
    this.fStateRing = document.getElementById('f-state-ring')!;
    this.fStatePinky = document.getElementById('f-state-pinky')!;
    this.hudGestureLabel = document.getElementById('hud-gesture-label')!;

    // Initialize 21 landmarks array
    for (let i = 0; i < 21; i++) {
      this.targetLandmarks.push({ x: 0, y: 0 });
      this.smoothLandmarks.push({ x: 0, y: 0 });
    }

    this.initCanvasSize();
    this.initEventListeners();
    this.setGestureState('none', 'Включите камеру', 'Нажмите кнопку «Включить камеру»');

    // Pre-initialize MediaPipe Hands model
    this.initMediaPipeHands();

    // Start 60fps cursor & skeleton render loop
    this.renderCursorLoop();
  }

  // Adjust canvas size to window with pixel ratio support
  private initCanvasSize(): void {
    const dpr = window.devicePixelRatio || 1;
    const width = window.innerWidth;
    const height = window.innerHeight;

    this.drawingCanvas.width = width * dpr;
    this.drawingCanvas.height = height * dpr;
    this.cursorCanvas.width = width * dpr;
    this.cursorCanvas.height = height * dpr;

    this.drawingCtx.resetTransform();
    this.drawingCtx.scale(dpr, dpr);
    this.cursorCtx.resetTransform();
    this.cursorCtx.scale(dpr, dpr);

    this.redrawCanvas();
  }

  // Event Listeners
  private initEventListeners(): void {
    window.addEventListener('resize', () => this.initCanvasSize());

    // Camera buttons
    this.btnStartHero.addEventListener('click', () => this.startCamera());
    this.btnToggleCamera.addEventListener('click', () => {
      if (this.isCameraActive) {
        this.stopCamera();
      } else {
        this.startCamera();
      }
    });

    // Toolbar visibility toggle
    this.btnHideToolbar.addEventListener('click', () => {
      this.toolbar.classList.add('toolbar-hidden');
      this.btnShowToolbar.classList.remove('hidden');
    });

    this.btnShowToolbar.addEventListener('click', () => {
      this.toolbar.classList.remove('toolbar-hidden');
      this.btnShowToolbar.classList.add('hidden');
    });

    // HUD Telemetry toggle
    this.btnToggleHud.addEventListener('click', () => {
      const isHidden = this.handHudPanel.classList.toggle('hud-hidden');
      this.btnToggleHud.classList.toggle('active', !isHidden);
    });

    // Mirror toggle
    this.btnMirrorToggle.addEventListener('click', () => {
      this.isMirrored = !this.isMirrored;
      if (this.isMirrored) {
        this.video.classList.remove('unmirrored');
      } else {
        this.video.classList.add('unmirrored');
      }
    });

    // Fullscreen toggle
    this.btnFullscreen.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    });

    // Color buttons
    const colorButtons = document.querySelectorAll('.color-btn');
    colorButtons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLElement;
        const color = target.dataset.color || '#ffffff';
        this.selectColor(color, target);
      });
    });

    // Palette toggle & close
    const btnTogglePalette = document.getElementById('btn-toggle-palette');
    const paletteDrawer = document.getElementById('full-palette-drawer');
    const btnClosePalette = document.getElementById('btn-close-palette');

    if (btnTogglePalette && paletteDrawer) {
      btnTogglePalette.addEventListener('click', () => {
        const isHidden = paletteDrawer.classList.toggle('drawer-hidden');
        btnTogglePalette.classList.toggle('active', !isHidden);
      });
    }

    if (btnClosePalette && paletteDrawer && btnTogglePalette) {
      btnClosePalette.addEventListener('click', () => {
        paletteDrawer.classList.add('drawer-hidden');
        btnTogglePalette.classList.remove('active');
      });
    }

    // Eraser button
    this.btnEraser.addEventListener('click', () => {
      this.toggleEraser();
    });

    // Brush preset buttons (2, 5, 10, 18, 30) & slider
    const brushSizeButtons = document.querySelectorAll('.brush-size-btn');
    const brushSlider = document.getElementById('brush-size-slider') as HTMLInputElement | null;
    const brushDisplay = document.getElementById('brush-size-display');

    brushSizeButtons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLElement;
        const size = parseInt(target.dataset.size || '5', 10);
        this.brushSize = size;
        brushSizeButtons.forEach((b) => b.classList.remove('active'));
        target.classList.add('active');
        if (brushSlider) brushSlider.value = String(size);
        if (brushDisplay) brushDisplay.textContent = `${size}px`;
        this.showTemporaryStatusHint(`Толщина кисти: ${size}px`);
      });
    });

    if (brushSlider) {
      brushSlider.addEventListener('input', () => {
        const size = parseInt(brushSlider.value, 10);
        this.brushSize = size;
        if (brushDisplay) brushDisplay.textContent = `${size}px`;
        brushSizeButtons.forEach((btn) => {
          const btnSize = parseInt((btn as HTMLElement).dataset.size || '0', 10);
          btn.classList.toggle('active', btnSize === size);
        });
      });
    }

    // Brush style buttons (Solid, Neon, Rainbow, Sparkle)
    const brushStyleButtons = document.querySelectorAll('.brush-style-btn');
    brushStyleButtons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLElement;
        const style = (target.dataset.style || 'solid') as BrushStyle;
        this.currentBrushStyle = style;
        brushStyleButtons.forEach((b) => b.classList.remove('active'));
        target.classList.add('active');
        this.soundFx.playPop();
        const names: Record<BrushStyle, string> = {
          solid: 'Классическая кисть 🖌️',
          neon: 'Неоновое свечение ⚡',
          rainbow: 'Радужная кисть 🌈',
          sparkle: 'Искры и звёзды ✨',
        };
        this.showTemporaryStatusHint(`Стиль кисти: ${names[style]}`);
      });
    });

    // Clear canvas button
    this.btnClear.addEventListener('click', () => {
      this.clearCanvas();
    });

    // Undo & Redo buttons
    this.btnUndo.addEventListener('click', () => {
      this.undoLastStroke();
    });
    this.btnRedo.addEventListener('click', () => {
      this.redoLastStroke();
    });

    // Reset View buttons
    this.btnResetView.addEventListener('click', () => this.resetView());
    this.btnQuickResetView.addEventListener('click', () => this.resetView());

    // Save PNG button (opens Save Options Modal)
    this.btnSave.addEventListener('click', () => {
      this.openSaveModal();
    });

    // Save Modal Options
    this.btnCloseSaveModal.addEventListener('click', () => this.closeSaveModal());
    this.btnSaveBlack.addEventListener('click', () => this.exportDrawing('black'));
    this.btnSaveTransparent.addEventListener('click', () => this.exportDrawing('transparent'));
    this.btnSavePhoto.addEventListener('click', () => this.exportDrawing('photo'));

    // Header controls
    this.btnBgMode.addEventListener('click', () => this.toggleBackgroundMode());
    this.btnSoundToggle.addEventListener('click', () => this.toggleSound());
    this.btnHelpGuide.addEventListener('click', () => this.toggleCheatsheetModal());
    this.btnCloseCheatsheet.addEventListener('click', () => this.toggleCheatsheetModal());

    // Keyboard shortcuts
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y' || e.key === 'н' || e.key === 'Н')) {
        e.preventDefault();
        this.redoLastStroke();
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'z' || e.key === 'Z' || e.key === 'я' || e.key === 'Я')) {
        e.preventDefault();
        this.redoLastStroke();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z' || e.key === 'я' || e.key === 'Я')) {
        e.preventDefault();
        this.undoLastStroke();
      } else if (e.key === 'c' || e.key === 'C' || e.key === 'с' || e.key === 'С') {
        this.clearCanvas();
      } else if (e.key === 'e' || e.key === 'E' || e.key === 'у' || e.key === 'У') {
        this.toggleEraser();
      } else if (e.key === 'h' || e.key === 'H' || e.key === 'р' || e.key === 'Р') {
        this.toolbar.classList.toggle('toolbar-hidden');
        this.btnShowToolbar.classList.toggle('hidden');
      } else if (e.key === 's' || e.key === 'S' || e.key === 'ы' || e.key === 'Ы') {
        this.openSaveModal();
      } else if (e.key === 'b' || e.key === 'B' || e.key === 'и' || e.key === 'И') {
        this.toggleBackgroundMode();
      } else if (e.key === 'm' || e.key === 'M' || e.key === 'ь' || e.key === 'Ь') {
        this.toggleSound();
      } else if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        this.toggleCheatsheetModal();
      } else if (e.key === '0' || e.key === 'r' || e.key === 'R') {
        this.resetView();
      }
    });

    // Fallback: mouse / touch drawing directly on canvas
    this.drawingCanvas.addEventListener('pointerdown', (e) => {
      this.isMouseDown = true;
      const worldPt = this.screenToWorld(e.clientX, e.clientY);
      this.startStroke(worldPt.x, worldPt.y);
    });

    window.addEventListener('pointermove', (e) => {
      if (this.isMouseDown) {
        const worldPt = this.screenToWorld(e.clientX, e.clientY);
        this.addStrokePoint(worldPt.x, worldPt.y);
      }
    });

    window.addEventListener('pointerup', () => {
      if (this.isMouseDown) {
        this.isMouseDown = false;
        this.finishStroke();
      }
    });
  }

  // World <-> Screen transformations
  private screenToWorld(screenX: number, screenY: number): Point {
    return {
      x: (screenX - this.panOffsetX) / this.zoomScale,
      y: (screenY - this.panOffsetY) / this.zoomScale,
    };
  }

  // MediaPipe Hands Initialization
  private async initMediaPipeHands(): Promise<void> {
    try {
      const HandsConstructor = await this.getHandsConstructor();
      if (!HandsConstructor) {
        console.warn('MediaPipe Hands is loading...');
        return;
      }

      this.hands = new HandsConstructor({
        locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
      });

      this.hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 1,
        minDetectionConfidence: 0.65,
        minTrackingConfidence: 0.65,
      });

      this.hands.onResults((results: HandsResults) => this.onHandResults(results));
      console.log('MediaPipe Hands initialized successfully');
    } catch (err) {
      console.error('Error initializing MediaPipe Hands:', err);
    }
  }

  private async getHandsConstructor(): Promise<any> {
    if ((window as any).Hands) {
      return (window as any).Hands;
    }
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 150));
      if ((window as any).Hands) {
        return (window as any).Hands;
      }
    }
    const mp = await import('@mediapipe/hands');
    return mp.Hands || (mp as any).default?.Hands || (window as any).Hands;
  }

  // Camera Management
  private async startCamera(): Promise<void> {
    this.cameraErrorBox.classList.add('hidden');
    this.btnStartHero.disabled = true;
    this.btnStartHero.innerHTML = `
      <span class="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
      <span>Запуск камеры...</span>
    `;

    try {
      if (!this.hands) {
        await this.initMediaPipeHands();
      }

      const constraints: MediaStreamConstraints = {
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user',
        },
        audio: false,
      };

      this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      this.video.srcObject = this.mediaStream;
      await this.video.play();

      this.isCameraActive = true;
      this.welcomeModal.classList.add('hidden');

      // Update Toolbar Camera Button state
      this.btnCameraText.textContent = 'Выключить камеру';
      this.cameraIconOn.classList.add('hidden');
      this.cameraIconOff.classList.remove('hidden');
      this.btnToggleCamera.classList.add('recording');

      this.setGestureState('none', 'Камера включена', 'Покажите руку перед камерой');

      // Frame loop via requestAnimationFrame
      this.processVideoFrames();
    } catch (error: any) {
      console.error('Camera access error:', error);
      this.isCameraActive = false;
      this.btnStartHero.disabled = false;
      this.btnStartHero.innerHTML = `
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/>
          <circle cx="12" cy="13" r="3"/>
        </svg>
        <span>Попробовать снова</span>
      `;

      let message = 'Не удалось получить доступ к веб-камере.';
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        message = 'Доступ к веб-камере был заблокирован в браузере. Разрешите доступ в строке URL и повторите попытку.';
      } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        message = 'Веб-камера не найдена. Убедитесь, что камера подключена к устройству.';
      } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
        message = 'Камера уже используется другим приложением. Закройте другие программы и попробуйте снова.';
      }

      this.cameraErrorMessage.textContent = message;
      this.cameraErrorBox.classList.remove('hidden');
      this.setGestureState('none', 'Включите камеру', 'Доступ к камере заблокирован');
    }
  }

  private stopCamera(): void {
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
    this.video.srcObject = null;
    this.isCameraActive = false;

    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    if (this.isDrawing) {
      this.finishStroke();
    }
    this.isHandDetected = false;
    this.currentGesture = 'none';
    this.clearHover();
    this.updateHudTelemetry();

    // Reset UI
    this.btnCameraText.textContent = 'Включить камеру';
    this.cameraIconOn.classList.remove('hidden');
    this.cameraIconOff.classList.add('hidden');
    this.btnToggleCamera.classList.remove('recording');

    this.setGestureState('none', 'Включите камеру', 'Нажмите кнопку «Включить камеру»');
  }

  private async processVideoFrames(): Promise<void> {
    if (!this.isCameraActive) return;

    if (
      this.video.readyState >= 2 &&
      !this.isProcessingFrame &&
      this.hands &&
      !this.video.paused &&
      !this.video.ended
    ) {
      this.isProcessingFrame = true;
      try {
        await this.hands.send({ image: this.video });
      } catch (err) {
        console.warn('Frame send warning:', err);
      } finally {
        this.isProcessingFrame = false;
      }
    }

    this.animationFrameId = requestAnimationFrame(() => this.processVideoFrames());
  }

  // -------------------------------------------------------------
  // BIOMECHANICAL ANALYSIS OF ALL 21 LANDMARKS & 5 FINGERS
  // -------------------------------------------------------------

  /**
   * Angle between 3 3D vectors (A -> B -> C) at vertex B in degrees.
   */
  private compute3DAngle(a: Landmark, b: Landmark, c: Landmark): number {
    const v1x = a.x - b.x;
    const v1y = a.y - b.y;
    const v1z = a.z - b.z;
    const v2x = c.x - b.x;
    const v2y = c.y - b.y;
    const v2z = c.z - b.z;

    const dot = v1x * v2x + v1y * v2y + v1z * v2z;
    const mag1 = Math.hypot(v1x, v1y, v1z);
    const mag2 = Math.hypot(v2x, v2y, v2z);

    if (mag1 * mag2 === 0) return 180;
    const cosTheta = Math.max(-1, Math.min(1, dot / (mag1 * mag2)));
    return (Math.acos(cosTheta) * 180) / Math.PI;
  }

  /**
   * 3D Euclidean distance between two landmarks.
   */
  private dist3D(a: Landmark, b: Landmark): number {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  }

  /**
   * Evaluates state of each of the 5 fingers from complete joint chain.
   */
  private evaluateFingerStates(lm: Landmark[], handScale: number): FingerStates {
    const wrist = lm[0];

    // Helper for 4 standard fingers (Index, Middle, Ring, Pinky)
    // chain: MCP, PIP, DIP, TIP
    const evaluateStandardFinger = (
      mcpIdx: number,
      pipIdx: number,
      dipIdx: number,
      tipIdx: number
    ): FingerState => {
      const mcp = lm[mcpIdx];
      const pip = lm[pipIdx];
      const dip = lm[dipIdx];
      const tip = lm[tipIdx];

      // Joint angles
      const pipAngle = this.compute3DAngle(mcp, pip, dip);
      const dipAngle = this.compute3DAngle(pip, dip, tip);

      // Distances
      const dTipWrist = this.dist3D(tip, wrist);
      const dPipWrist = this.dist3D(pip, wrist);
      const dTipMcp = this.dist3D(tip, mcp);

      const segmentSum = this.dist3D(mcp, pip) + this.dist3D(pip, dip) + this.dist3D(dip, tip);
      const extensionRatio = segmentSum > 0 ? dTipMcp / segmentSum : 0.5;

      // Deep folded check
      const isFoldedAngle = pipAngle < 118 || dipAngle < 115;
      const isFoldedDist = dTipWrist < dPipWrist * 1.05 || extensionRatio < 0.52;

      // Extended check
      const isExtendedAngle = pipAngle > 145 && dipAngle > 135;
      const isExtendedDist = dTipWrist > dPipWrist * 1.15 && extensionRatio > 0.72;

      if (isExtendedAngle && isExtendedDist) {
        return 'extended';
      }
      if (isFoldedAngle && isFoldedDist) {
        return 'folded';
      }
      return 'partial';
    };

    // Index (5, 6, 7, 8)
    const index = evaluateStandardFinger(5, 6, 7, 8);
    // Middle (9, 10, 11, 12)
    const middle = evaluateStandardFinger(9, 10, 11, 12);
    // Ring (13, 14, 15, 16)
    const ring = evaluateStandardFinger(13, 14, 15, 16);
    // Pinky (17, 18, 19, 20)
    const pinky = evaluateStandardFinger(17, 18, 19, 20);

    // Thumb (0, 1, 2, 3, 4)
    const thumbCmc = lm[1];
    const thumbMcp = lm[2];
    const thumbIp = lm[3];
    const thumbTip = lm[4];
    const indexMcp = lm[5];
    const pinkyMcp = lm[17];

    const thumbMcpAngle = this.compute3DAngle(thumbCmc, thumbMcp, thumbIp);
    const thumbIpAngle = this.compute3DAngle(thumbMcp, thumbIp, thumbTip);

    const dThumbIndexMcp = this.dist3D(thumbTip, indexMcp) / handScale;
    const dThumbPinkyMcp = this.dist3D(thumbTip, pinkyMcp) / handScale;
    const dThumbWrist = this.dist3D(thumbTip, wrist) / handScale;

    let thumb: FingerState = 'partial';
    if (thumbMcpAngle > 140 && thumbIpAngle > 145 && dThumbIndexMcp > 0.45 && dThumbWrist > 0.55) {
      thumb = 'extended';
    } else if (thumbIpAngle < 120 || dThumbIndexMcp < 0.28 || dThumbPinkyMcp < 0.5) {
      thumb = 'folded';
    }

    return { thumb, index, middle, ring, pinky };
  }

  // -------------------------------------------------------------
  // MEDIAPIPE RESULTS HANDLER & GESTURE CLASSIFIER
  // -------------------------------------------------------------
  private onHandResults(results: HandsResults): void {
    if (!this.isCameraActive) return;

    const hasHand = Boolean(results.multiHandLandmarks && results.multiHandLandmarks.length > 0);

    if (!hasHand) {
      if (this.isHandDetected) {
        this.isHandDetected = false;
        if (this.isDrawing) this.finishStroke();
        this.isPanning = false;
        this.panActive = false;
        this.isZooming = false;
        this.clearHover();
      }
      this.handConfidence = 0;
      this.handSideLabel = 'Рука не найдена';
      this.updateHudTelemetry();
      this.setGestureState('none', 'Рука не найдена', 'Держите ладонь в поле зрения камеры');
      return;
    }

    this.isHandDetected = true;
    const lm = results.multiHandLandmarks![0];
    this.rawLandmarks = lm;

    // Handedness & Confidence
    if (results.multiHandedness && results.multiHandedness.length > 0) {
      const h = results.multiHandedness[0];
      this.handConfidence = Math.round((h.score || 0.95) * 100);
      // MediaPipe inverted camera coordinate mapping
      const isRight = this.isMirrored ? h.label === 'Left' : h.label === 'Right';
      this.handSideLabel = isRight ? 'Правая рука' : 'Левая рука';
    } else {
      this.handConfidence = 95;
      this.handSideLabel = 'Рука обнаружена';
    }

    const screenWidth = window.innerWidth;
    const screenHeight = window.innerHeight;

    // Map all 21 landmarks to 2D Screen coordinates (with mirroring)
    for (let i = 0; i < 21; i++) {
      const pt = lm[i];
      const screenX = this.isMirrored ? (1 - pt.x) * screenWidth : pt.x * screenWidth;
      const screenY = pt.y * screenHeight;
      this.targetLandmarks[i] = { x: screenX, y: screenY };
    }

    // Hand scale reference (wrist to middle MCP)
    const handScale = this.dist3D(lm[0], lm[9]) || 0.28;

    // Palm center calculation (average of Wrist, Index MCP, Middle MCP, Ring MCP, Pinky MCP)
    const palmIndices = [0, 5, 9, 13, 17];
    let sumPalmX = 0;
    let sumPalmY = 0;
    for (const idx of palmIndices) {
      sumPalmX += this.targetLandmarks[idx].x;
      sumPalmY += this.targetLandmarks[idx].y;
    }
    this.targetPalmCenter = {
      x: sumPalmX / palmIndices.length,
      y: sumPalmY / palmIndices.length,
    };

    // Biomechanical finger analysis
    this.fingerStates = this.evaluateFingerStates(lm, handScale);

    // Distance between thumb and index tips for pinch
    const pinchDist = this.dist3D(lm[4], lm[8]);
    const isPinching = pinchDist < handScale * 0.35;

    // -------------------------------------------------------------
    // GESTURE CLASSIFICATION BASED ON COMPLETE FINGER STATES
    // -------------------------------------------------------------
    const { thumb, index, middle, ring, pinky } = this.fingerStates;
    let rawGesture: GestureType = 'wait';

    // Biomechanical states:
    const isRingPinkyNotExtended = ring !== 'extended' && pinky !== 'extended';

    // 1. ☝️ + 🖕 = РИСОВАНИЕ (Draw)
    // Рисование происходит ТОЛЬКО когда одновременно подняты:
    // указательный палец и средний палец, а остальные пальцы согнуты
    if (
      index === 'extended' &&
      middle === 'extended' &&
      isRingPinkyNotExtended
    ) {
      rawGesture = 'draw';
    }
    // 2. 🖕 Middle finger only (Undo)
    else if (middle === 'extended' && index === 'folded' && ring === 'folded' && pinky === 'folded') {
      rawGesture = 'undo';
    }
    // 3. ✊ Fist (Move / Pan): all 4 main fingers folded
    else if (index === 'folded' && middle === 'folded' && ring === 'folded' && pinky === 'folded') {
      rawGesture = 'move';
    }
    // 4. 🖐️ Open palm (Wait / Stop): all 4 main fingers extended
    else if (index === 'extended' && middle === 'extended' && ring === 'extended' && pinky === 'extended') {
      rawGesture = 'wait';
    }
    // 5. 👌 OK Gesture: thumb + index pinching, and middle/ring/pinky extended
    else if (isPinching && (ring === 'extended' || pinky === 'extended')) {
      rawGesture = 'ok';
    }
    // 6. ☝️ Index finger only (Cursor): index extended, other 3 not extended
    else if (index === 'extended' && middle !== 'extended' && ring !== 'extended' && pinky !== 'extended') {
      rawGesture = 'cursor';
    } else {
      rawGesture = 'cursor';
    }

    // Debounce / hysteresis: requires 3 matching frames before switching
    if (rawGesture === this.pendingGesture) {
      this.pendingGestureFrames++;
      const reqFrames = rawGesture === 'draw' || this.currentGesture === 'draw' ? 2 : 3;
      if (this.pendingGestureFrames >= reqFrames) {
        if (this.currentGesture !== rawGesture) {
          this.onGestureTransition(this.currentGesture, rawGesture);
          this.currentGesture = rawGesture;
        }
      }
    } else {
      this.pendingGesture = rawGesture;
      this.pendingGestureFrames = 1;
    }

    // Update HUD telemetry values
    this.updateHudTelemetry();

    // Execute active gesture action
    this.handleActiveGesture(lm);
  }

  // Update Telemetry HUD panel
  private updateHudTelemetry(): void {
    if (!this.hudHandedness) return;

    this.hudHandedness.textContent = this.handSideLabel;
    this.hudConfidenceVal.textContent = `${this.handConfidence}%`;
    this.hudConfidenceFill.style.width = `${this.handConfidence}%`;

    const updateChip = (el: HTMLElement, state: FingerState) => {
      el.className = 'hud-finger-state';
      if (!this.isHandDetected) {
        el.classList.add('state-wait');
        el.textContent = '—';
        return;
      }
      switch (state) {
        case 'extended':
          el.classList.add('state-extended');
          el.textContent = 'Разогнут';
          break;
        case 'folded':
          el.classList.add('state-folded');
          el.textContent = 'Согнут';
          break;
        case 'partial':
          el.classList.add('state-partial');
          el.textContent = 'Частично';
          break;
      }
    };

    updateChip(this.fStateThumb, this.fingerStates.thumb);
    updateChip(this.fStateIndex, this.fingerStates.index);
    updateChip(this.fStateMiddle, this.fingerStates.middle);
    updateChip(this.fStateRing, this.fingerStates.ring);
    updateChip(this.fStatePinky, this.fingerStates.pinky);

    const gestureNames: Record<GestureType, string> = {
      cursor: '☝️ Курсор',
      draw: '☝️+🖕 Рисование',
      move: '✊ Перемещение',
      zoom: '✌️ Масштабирование',
      wait: '🖐️ Ожидание',
      ok: '👌 Выбор (OK)',
      undo: '🖕 Отмена (Undo)',
      none: 'Ожидание...',
    };
    this.hudGestureLabel.textContent = gestureNames[this.currentGesture];
  }

  // Gesture Transition
  private onGestureTransition(prev: GestureType, next: GestureType): void {
    // If leaving drawing, finish current stroke
    if (prev === 'draw' && next !== 'draw') {
      this.finishStroke();
    }

    // If leaving panning, stop pan
    if (prev === 'move') {
      this.isPanning = false;
      this.panActive = false;
    }

    // If leaving zooming, stop zoom
    if (prev === 'zoom') {
      this.isZooming = false;
    }

    // Update Status Pill
    switch (next) {
      case 'cursor':
        this.setGestureState('cursor', '☝️ Курсор', 'Передвигайте указательный палец');
        break;
      case 'draw':
        this.setGestureState('draw', '☝️+🖕 Рисование', 'Указательный + средний подняты — рисуем');
        break;
      case 'move':
        this.setGestureState('move', '✊ Перемещение', 'Двигайте сжатый кулак для сдвига');
        // Protection from sudden jump: capture exact current position as origin
        this.panStartScreenX = this.smoothPalmCenter.x;
        this.panStartScreenY = this.smoothPalmCenter.y;
        this.panBaseOffsetX = this.panOffsetX;
        this.panBaseOffsetY = this.panOffsetY;
        this.isPanning = true;
        this.panActive = false; // requires deadzone before moving
        break;
      case 'zoom':
        this.setGestureState('zoom', '✌️ Масштабирование', 'Разводите или сближайте 2 пальца');
        this.isZooming = false;
        break;
      case 'wait':
        this.setGestureState('wait', '🖐️ Ожидание', 'Холст зафиксирован');
        break;
      case 'ok':
        this.setGestureState('ok', '👌 Выбор', 'Подтверждение выбранного инструмента');
        break;
      case 'undo':
        this.setGestureState('undo', '🖕 Отмена', 'Отмена последнего штриха');
        break;
    }

    this.updateCheatsheetActive();
  }

  // Active Gesture Logic Execution
  private handleActiveGesture(landmarks: Landmark[]): void {
    const px = this.smoothLandmarks[8].x; // Index tip
    const py = this.smoothLandmarks[8].y;

    // Check hover over toolbar buttons
    this.updateHandHover(px, py);

    switch (this.currentGesture) {
      case 'cursor':
        break;

      case 'draw':
        if (this.hoveredElement) {
          // Pinch over a button = Click button
          this.triggerHandClick(this.hoveredElement);
        } else {
          // Pinch on canvas = Draw!
          const worldPt = this.screenToWorld(px, py);
          if (!this.isDrawing) {
            this.startStroke(worldPt.x, worldPt.y);
          } else {
            this.addStrokePoint(worldPt.x, worldPt.y);
          }
        }
        break;

      case 'ok':
        if (this.hoveredElement) {
          this.triggerHandClick(this.hoveredElement);
        }
        break;

      case 'move':
        // Fist Pan with jump protection & deadzone
        if (this.isPanning) {
          const deltaX = this.smoothPalmCenter.x - this.panStartScreenX;
          const deltaY = this.smoothPalmCenter.y - this.panStartScreenY;
          const distFromStart = Math.hypot(deltaX, deltaY);

          // Deadzone of 4px before starting pan to prevent jitter
          if (!this.panActive && distFromStart > 4) {
            this.panActive = true;
          }

          if (this.panActive) {
            this.panOffsetX = this.panBaseOffsetX + deltaX;
            this.panOffsetY = this.panBaseOffsetY + deltaY;
            this.updateViewIndicator();
            this.redrawCanvas();
          }
        }
        break;

      case 'zoom':
        // Two fingers zoom
        const middleTip = landmarks[12];
        const indexTip = landmarks[8];
        const dist = Math.hypot(indexTip.x - middleTip.x, indexTip.y - middleTip.y);

        const centerScreenX = (this.smoothLandmarks[8].x + this.smoothLandmarks[12].x) / 2;
        const centerScreenY = (this.smoothLandmarks[8].y + this.smoothLandmarks[12].y) / 2;

        if (!this.isZooming) {
          this.isZooming = true;
          this.zoomStartDist = Math.max(dist, 0.02);
          this.zoomBaseScale = this.zoomScale;
          this.zoomCenterX = centerScreenX;
          this.zoomCenterY = centerScreenY;
          this.zoomWorldCenterX = (centerScreenX - this.panOffsetX) / this.zoomScale;
          this.zoomWorldCenterY = (centerScreenY - this.panOffsetY) / this.zoomScale;
        } else {
          const ratio = dist / this.zoomStartDist;
          const targetZoom = Math.min(4.0, Math.max(0.3, this.zoomBaseScale * ratio));

          this.zoomScale += (targetZoom - this.zoomScale) * 0.3;

          this.panOffsetX = this.zoomCenterX - this.zoomWorldCenterX * this.zoomScale;
          this.panOffsetY = this.zoomCenterY - this.zoomWorldCenterY * this.zoomScale;

          this.updateViewIndicator();
          this.redrawCanvas();
        }
        break;

      case 'undo':
        const now = Date.now();
        if (now - this.lastUndoTime > this.UNDO_COOLDOWN_MS) {
          this.lastUndoTime = now;
          this.undoLastStroke();
        }
        break;

      case 'wait':
        break;
    }
  }

  // Hover detection on toolbar
  private updateHandHover(x: number, y: number): void {
    const interactiveElements = document.querySelectorAll<HTMLElement>(
      '.tool-btn, .color-btn, .btn-icon, .btn-show-toolbar, .hero-start-btn, .view-reset-mini-btn'
    );

    let found: HTMLElement | null = null;
    for (const el of interactiveElements) {
      const rect = el.getBoundingClientRect();
      if (
        x >= rect.left - 6 &&
        x <= rect.right + 6 &&
        y >= rect.top - 6 &&
        y <= rect.bottom + 6
      ) {
        found = el;
        break;
      }
    }

    if (this.hoveredElement !== found) {
      if (this.hoveredElement) {
        this.hoveredElement.classList.remove('hand-hover');
      }
      this.hoveredElement = found;
      if (found) {
        found.classList.add('hand-hover');
      }
    }
  }

  private clearHover(): void {
    if (this.hoveredElement) {
      this.hoveredElement.classList.remove('hand-hover');
      this.hoveredElement = null;
    }
  }

  private triggerHandClick(element: HTMLElement): void {
    const now = Date.now();
    if (now - this.lastHandClickTime < this.HAND_CLICK_COOLDOWN_MS) {
      return;
    }
    this.lastHandClickTime = now;

    element.classList.add('hand-clicked');
    setTimeout(() => element.classList.remove('hand-clicked'), 350);
    element.click();
  }

  // -------------------------------------------------------------
  // 60FPS SKELETON & CURSOR RENDERING LOOP
  // -------------------------------------------------------------
  private renderCursorLoop(): void {
    this.cursorCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    if (this.isHandDetected) {
      // Exponential smoothing for all 21 points
      const alpha = 0.38;

      for (let i = 0; i < 21; i++) {
        if (this.smoothLandmarks[i].x === 0 && this.smoothLandmarks[i].y === 0) {
          this.smoothLandmarks[i].x = this.targetLandmarks[i].x;
          this.smoothLandmarks[i].y = this.targetLandmarks[i].y;
        } else {
          this.smoothLandmarks[i].x += (this.targetLandmarks[i].x - this.smoothLandmarks[i].x) * alpha;
          this.smoothLandmarks[i].y += (this.targetLandmarks[i].y - this.smoothLandmarks[i].y) * alpha;
        }
      }

      // Palm center smoothing
      if (this.smoothPalmCenter.x === 0 && this.smoothPalmCenter.y === 0) {
        this.smoothPalmCenter = { ...this.targetPalmCenter };
      } else {
        this.smoothPalmCenter.x += (this.targetPalmCenter.x - this.smoothPalmCenter.x) * alpha;
        this.smoothPalmCenter.y += (this.targetPalmCenter.y - this.smoothPalmCenter.y) * alpha;
      }

      // Compute velocity & speed of palm
      const vx = this.smoothPalmCenter.x - this.prevPalmX;
      const vy = this.smoothPalmCenter.y - this.prevPalmY;
      this.prevPalmX = this.smoothPalmCenter.x;
      this.prevPalmY = this.smoothPalmCenter.y;

      // Smoothed velocity vector
      this.handVelX += (vx - this.handVelX) * 0.35;
      this.handVelY += (vy - this.handVelY) * 0.35;
      this.handSpeed = Math.hypot(this.handVelX, this.handVelY);

      // Air Dwell auto-click logic when index finger hovers over interactive button
      if (this.currentGesture === 'cursor' && this.hoveredElement) {
        if (this.hoverStartTime === 0) {
          this.hoverStartTime = Date.now();
        }
        const elapsed = Date.now() - this.hoverStartTime;
        this.dwellProgress = Math.min(1, elapsed / this.DWELL_CLICK_TIME_MS);
        if (this.dwellProgress >= 1) {
          this.triggerHandClick(this.hoveredElement);
          this.hoverStartTime = Date.now() + 450;
          this.dwellProgress = 0;
        }
      } else {
        this.hoverStartTime = 0;
        this.dwellProgress = 0;
      }

      // 1. Draw Full Anatomical Skeleton from Palm to Fingertips
      this.drawFullHandSkeleton();

      // 2. Draw Movement Direction Arrow during Pan (✊ Move)
      if (this.currentGesture === 'move') {
        this.drawMoveDirectionArrow();
      }

      // 3. Draw Gesture Status & Feedback Overlays
      this.drawGestureFeedback();
    }

    requestAnimationFrame(() => this.renderCursorLoop());
  }

  /**
   * Renders the complete 21-landmark hand skeleton:
   * Palm foundation + 5 full finger joint chains + joint nodes.
   */
  private drawFullHandSkeleton(): void {
    const ctx = this.cursorCtx;
    const pts = this.smoothLandmarks;
    const palm = this.smoothPalmCenter;

    ctx.save();

    // 1. Semi-transparent Palm Polygon Foundation
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y); // Wrist
    ctx.lineTo(pts[5].x, pts[5].y); // Index MCP
    ctx.lineTo(pts[9].x, pts[9].y); // Middle MCP
    ctx.lineTo(pts[13].x, pts[13].y); // Ring MCP
    ctx.lineTo(pts[17].x, pts[17].y); // Pinky MCP
    ctx.closePath();
    ctx.fillStyle = 'rgba(99, 102, 241, 0.08)';
    ctx.fill();

    // 2. Palm Structure Lines from Wrist (0) to Palm Center and MCPs
    ctx.strokeStyle = 'rgba(129, 140, 248, 0.45)';
    ctx.lineWidth = 2.5;

    // Transverse MCP Arch
    ctx.beginPath();
    ctx.moveTo(pts[5].x, pts[5].y);
    ctx.lineTo(pts[9].x, pts[9].y);
    ctx.lineTo(pts[13].x, pts[13].y);
    ctx.lineTo(pts[17].x, pts[17].y);
    ctx.stroke();

    // Radial Palm Lines (Wrist to each finger base)
    const palmRays = [
      [0, 1], // Wrist to Thumb CMC
      [0, 5], // Wrist to Index MCP
      [0, 9], // Wrist to Middle MCP
      [0, 13], // Wrist to Ring MCP
      [0, 17], // Wrist to Pinky MCP
    ];

    ctx.lineWidth = 2.2;
    for (const [start, end] of palmRays) {
      ctx.beginPath();
      ctx.moveTo(pts[start].x, pts[start].y);
      ctx.lineTo(pts[end].x, pts[end].y);
      ctx.stroke();
    }

    // Connect Palm Center to Wrist and Middle MCP
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    ctx.lineTo(palm.x, palm.y);
    ctx.lineTo(pts[9].x, pts[9].y);
    ctx.strokeStyle = 'rgba(168, 85, 247, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([2, 3]);
    ctx.stroke();
    ctx.setLineDash([]);

    // 3. 5 Finger Joint Chains: Palm -> Base -> PIP -> DIP -> Tip
    const fingerChains = [
      { name: 'thumb', indices: [1, 2, 3, 4], state: this.fingerStates.thumb },
      { name: 'index', indices: [5, 6, 7, 8], state: this.fingerStates.index },
      { name: 'middle', indices: [9, 10, 11, 12], state: this.fingerStates.middle },
      { name: 'ring', indices: [13, 14, 15, 16], state: this.fingerStates.ring },
      { name: 'pinky', indices: [17, 18, 19, 20], state: this.fingerStates.pinky },
    ];

    for (const chain of fingerChains) {
      const idxs = chain.indices;

      // Color based on finger state
      let boneColor = 'rgba(255, 255, 255, 0.6)';
      if (chain.state === 'extended') {
        boneColor = 'rgba(52, 211, 153, 0.75)'; // Emerald
      } else if (chain.state === 'folded') {
        boneColor = 'rgba(248, 113, 113, 0.65)'; // Rose
      } else {
        boneColor = 'rgba(251, 191, 36, 0.7)'; // Amber
      }

      ctx.strokeStyle = boneColor;
      ctx.lineWidth = 2.8;

      ctx.beginPath();
      ctx.moveTo(pts[idxs[0]].x, pts[idxs[0]].y);
      for (let k = 1; k < idxs.length; k++) {
        ctx.lineTo(pts[idxs[k]].x, pts[idxs[k]].y);
      }
      ctx.stroke();
    }

    // 4. Draw All 21 Joint Nodes with Visual Hierarchy
    for (let i = 0; i < 21; i++) {
      const p = pts[i];
      let radius = 3.5;
      let fill = '#ffffff';
      let stroke = 'rgba(0, 0, 0, 0.5)';
      let strokeWidth = 1.5;

      if (i === 0) {
        // Wrist
        radius = 5.5;
        fill = '#818cf8';
      } else if ([1, 5, 9, 13, 17].includes(i)) {
        // MCP Knuckles
        radius = 4.5;
        fill = '#c7d2fe';
      } else if ([4, 8, 12, 16, 20].includes(i)) {
        // Fingertips (Color-coded by finger state)
        radius = 5;
        const state =
          i === 4
            ? this.fingerStates.thumb
            : i === 8
            ? this.fingerStates.index
            : i === 12
            ? this.fingerStates.middle
            : i === 16
            ? this.fingerStates.ring
            : this.fingerStates.pinky;

        fill = state === 'extended' ? '#10b981' : state === 'folded' ? '#ef4444' : '#f59e0b';
      }

      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = strokeWidth;
      ctx.strokeStyle = stroke;
      ctx.stroke();
    }

    // Subtle Palm Center Hub
    ctx.beginPath();
    ctx.arc(palm.x, palm.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(168, 85, 247, 0.7)';
    ctx.fill();

    ctx.restore();
  }

  /**
   * Draws dynamic direction arrow during Fist Pan (✊ Move):
   * Direction corresponds to movement velocity vector; length scales with speed.
   */
  private drawMoveDirectionArrow(): void {
    const ctx = this.cursorCtx;
    const cx = this.smoothPalmCenter.x;
    const cy = this.smoothPalmCenter.y;
    const speed = this.handSpeed;

    // Show arrow only when moving steadily (speed >= 1.8 px/frame)
    if (speed < 1.8) {
      // Stationary: small pulsing center point
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, 7, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(245, 158, 11, 0.4)';
      ctx.fill();
      ctx.restore();
      return;
    }

    ctx.save();

    const angle = Math.atan2(this.handVelY, this.handVelX);
    // Length scales with speed (clamped between 28px and 90px)
    const arrowLength = Math.min(90, Math.max(28, speed * 4.8));

    const endX = cx + Math.cos(angle) * arrowLength;
    const endY = cy + Math.sin(angle) * arrowLength;

    // Glowing shaft
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(endX, endY);
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Arrowhead
    const headSize = 12;
    const headAngle = Math.PI / 6;

    ctx.beginPath();
    ctx.moveTo(endX, endY);
    ctx.lineTo(
      endX - headSize * Math.cos(angle - headAngle),
      endY - headSize * Math.sin(angle - headAngle)
    );
    ctx.lineTo(
      endX - headSize * Math.cos(angle + headAngle),
      endY - headSize * Math.sin(angle + headAngle)
    );
    ctx.closePath();
    ctx.fillStyle = '#fef3c7';
    ctx.fill();
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.restore();
  }

  // Visual gesture indicator and pointer overlays
  private drawGestureFeedback(): void {
    const ctx = this.cursorCtx;
    const x = this.smoothLandmarks[8].x; // Index Tip
    const y = this.smoothLandmarks[8].y;
    const tx = this.smoothLandmarks[4].x; // Thumb Tip
    const ty = this.smoothLandmarks[4].y;

    ctx.save();

    // 1. Move Mode (✊ Fist): Grab badge
    if (this.currentGesture === 'move') {
      const cx = this.smoothPalmCenter.x;
      const cy = this.smoothPalmCenter.y;

      ctx.beginPath();
      ctx.arc(cx, cy, 26, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(245, 158, 11, 0.2)';
      ctx.fill();
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      ctx.restore();
      return;
    }

    // 2. Zoom Mode (✌️ Two Fingers): Line connecting index and middle tips
    if (this.currentGesture === 'zoom') {
      const mx = this.smoothLandmarks[12].x;
      const my = this.smoothLandmarks[12].y;

      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(mx, my);
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 3;
      ctx.stroke();

      const midX = (x + mx) / 2;
      const midY = (y + my) / 2;
      ctx.font = 'bold 12px "Plus Jakarta Sans", sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${Math.round(this.zoomScale * 100)}%`, midX, midY - 14);

      ctx.restore();
      return;
    }

    // 3. Undo Mode (🖕 Middle Finger): Cooldown arc & arrow
    if (this.currentGesture === 'undo') {
      const timeSinceUndo = Date.now() - this.lastUndoTime;
      const cooldownProgress = Math.min(1, timeSinceUndo / this.UNDO_COOLDOWN_MS);

      const mx = this.smoothLandmarks[12].x;
      const my = this.smoothLandmarks[12].y;

      ctx.beginPath();
      ctx.arc(mx, my, 22, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(168, 85, 247, 0.25)';
      ctx.fill();
      ctx.strokeStyle = '#a855f7';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(mx, my, 26, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * cooldownProgress);
      ctx.strokeStyle = '#d8b4fe';
      ctx.lineWidth = 3;
      ctx.stroke();

      ctx.font = 'bold 16px sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('↶', mx, my);

      ctx.restore();
      return;
    }

    // 4. Open Palm (🖐️ Wait)
    if (this.currentGesture === 'wait') {
      ctx.beginPath();
      ctx.arc(x, y, 14, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
      return;
    }

    // 5. OK Gesture (👌 Select)
    if (this.currentGesture === 'ok') {
      ctx.beginPath();
      ctx.arc(x, y, 18, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(34, 197, 94, 0.25)';
      ctx.fill();
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      ctx.font = 'bold 13px sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('✓', x, y);

      ctx.restore();
      return;
    }

    // 6. Draw (🤏) & Cursor (☝️)
    if (this.isEraserActive) {
      // Eraser cursor
      const eraserRadius = this.brushSize * 2.2 * this.zoomScale;
      ctx.beginPath();
      ctx.arc(x, y, eraserRadius, 0, Math.PI * 2);
      ctx.strokeStyle = this.currentGesture === 'draw' ? '#f43f5e' : 'rgba(244, 63, 94, 0.7)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#f43f5e';
      ctx.fill();
    } else {
      // Normal brush cursor
      const baseRadius = Math.max(6, this.brushSize * 0.8 * this.zoomScale);

      if (this.currentGesture === 'draw') {
        const mx = this.smoothLandmarks[12].x; // Middle tip
        const my = this.smoothLandmarks[12].y;

        // Glowing connection line between index and middle fingertips
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(mx, my);
        ctx.strokeStyle = 'rgba(52, 211, 153, 0.7)';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Active node on middle fingertip
        ctx.beginPath();
        ctx.arc(mx, my, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#34d399';
        ctx.fill();

        // Glowing active drawing pulse at index tip
        ctx.beginPath();
        ctx.arc(x, y, baseRadius + 7, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(52, 211, 153, 0.25)';
        ctx.fill();

        ctx.beginPath();
        ctx.arc(x, y, baseRadius + 2, 0, Math.PI * 2);
        ctx.fillStyle = this.currentColor === '#000000' ? '#27272a' : this.currentColor;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(x, y, baseRadius, 0, Math.PI * 2);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2.5;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
      } else {
        // Sleek cursor ring
        ctx.beginPath();
        ctx.arc(x, y, baseRadius + 2, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(x, y, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = this.currentColor === '#000000' ? '#ffffff' : this.currentColor;
        ctx.fill();

        // Air Dwell auto-click radial loading indicator
        if (this.dwellProgress > 0 && this.hoveredElement) {
          ctx.beginPath();
          ctx.arc(x, y, baseRadius + 7, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * this.dwellProgress);
          ctx.strokeStyle = '#818cf8';
          ctx.lineWidth = 3.5;
          ctx.stroke();
        }
      }
    }

    ctx.restore();
  }

  // -------------------------------------------------------------
  // CANVAS DRAWING & VECTOR STROKE ENGINE
  // -------------------------------------------------------------
  private startStroke(worldX: number, worldY: number): void {
    this.isDrawing = true;
    this.redoStack = [];
    this.soundFx.playWhoosh();
    this.rainbowHue = (this.rainbowHue + 14) % 360;

    this.currentStroke = {
      points: [{ x: worldX, y: worldY, hue: this.rainbowHue }],
      color: this.currentColor,
      size: this.brushSize,
      isEraser: this.isEraserActive,
      style: this.currentBrushStyle,
    };
    this.strokes.push(this.currentStroke);
    this.renderStrokeIncrement(this.currentStroke, true);
  }

  private addStrokePoint(worldX: number, worldY: number): void {
    if (!this.isDrawing || !this.currentStroke) return;

    const points = this.currentStroke.points;
    const lastPoint = points[points.length - 1];

    if (lastPoint && Math.hypot(worldX - lastPoint.x, worldY - lastPoint.y) < 1.5) {
      return;
    }

    this.rainbowHue = (this.rainbowHue + 8) % 360;
    points.push({ x: worldX, y: worldY, hue: this.rainbowHue });
    this.renderStrokeIncrement(this.currentStroke, false);
  }

  private finishStroke(): void {
    this.isDrawing = false;
    this.currentStroke = null;
  }

  private drawSparkleStar(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    r: number,
    color: string
  ): void {
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = color === '#000000' ? '#eab308' : color;
    ctx.shadowBlur = 8;

    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.45, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = color === '#000000' ? '#fde047' : color;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r * 0.25, cy - r * 0.25);
    ctx.lineTo(cx + r, cy);
    ctx.lineTo(cx + r * 0.25, cy + r * 0.25);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - r * 0.25, cy + r * 0.25);
    ctx.lineTo(cx - r, cy);
    ctx.lineTo(cx - r * 0.25, cy - r * 0.25);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  private renderStrokeSegment(
    ctx: CanvasRenderingContext2D,
    stroke: Stroke,
    _p0: StrokePoint,
    p1: StrokePoint,
    mid1X: number,
    mid1Y: number,
    mid2X: number,
    mid2Y: number
  ): void {
    const style = stroke.style || 'solid';

    if (stroke.isEraser) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineWidth = stroke.size * 3.8;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(mid1X, mid1Y);
      ctx.quadraticCurveTo(p1.x, p1.y, mid2X, mid2Y);
      ctx.stroke();
      return;
    }

    ctx.globalCompositeOperation = 'source-over';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (style === 'neon') {
      // Outer bright glowing halo
      ctx.save();
      const glowColor = stroke.color === '#000000' ? '#6366f1' : stroke.color;
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = Math.max(10, stroke.size * 2.8);
      ctx.strokeStyle = glowColor;
      ctx.lineWidth = stroke.size * 1.35;
      ctx.beginPath();
      ctx.moveTo(mid1X, mid1Y);
      ctx.quadraticCurveTo(p1.x, p1.y, mid2X, mid2Y);
      ctx.stroke();
      ctx.restore();

      // Inner white high-intensity luminescent core
      ctx.save();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(1.5, stroke.size * 0.45);
      ctx.beginPath();
      ctx.moveTo(mid1X, mid1Y);
      ctx.quadraticCurveTo(p1.x, p1.y, mid2X, mid2Y);
      ctx.stroke();
      ctx.restore();
    } else if (style === 'rainbow') {
      const hue = p1.hue !== undefined ? p1.hue : 0;
      ctx.save();
      ctx.shadowColor = `hsl(${hue}, 100%, 55%)`;
      ctx.shadowBlur = 8;
      ctx.strokeStyle = `hsl(${hue}, 100%, 65%)`;
      ctx.lineWidth = stroke.size;
      ctx.beginPath();
      ctx.moveTo(mid1X, mid1Y);
      ctx.quadraticCurveTo(p1.x, p1.y, mid2X, mid2Y);
      ctx.stroke();
      ctx.restore();
    } else if (style === 'sparkle') {
      ctx.save();
      ctx.shadowColor = stroke.color;
      ctx.shadowBlur = 6;
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.size;
      ctx.beginPath();
      ctx.moveTo(mid1X, mid1Y);
      ctx.quadraticCurveTo(p1.x, p1.y, mid2X, mid2Y);
      ctx.stroke();
      ctx.restore();

      // Sparkle stars along path
      this.drawSparkleStar(ctx, p1.x, p1.y, Math.max(4, stroke.size * 0.9), stroke.color);
    } else {
      // Solid classic
      ctx.strokeStyle = stroke.color;
      ctx.fillStyle = stroke.color;
      ctx.lineWidth = stroke.size;
      ctx.beginPath();
      ctx.moveTo(mid1X, mid1Y);
      ctx.quadraticCurveTo(p1.x, p1.y, mid2X, mid2Y);
      ctx.stroke();
    }
  }

  private renderStrokeIncrement(stroke: Stroke, isFirstDot: boolean): void {
    const ctx = this.drawingCtx;
    ctx.save();
    ctx.translate(this.panOffsetX, this.panOffsetY);
    ctx.scale(this.zoomScale, this.zoomScale);

    const points = stroke.points;
    if (isFirstDot || points.length === 1) {
      if (stroke.isEraser) {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();
        ctx.arc(points[0].x, points[0].y, stroke.size * 1.9, 0, Math.PI * 2);
        ctx.fill();
      } else if (stroke.style === 'neon') {
        ctx.save();
        ctx.shadowColor = stroke.color === '#000000' ? '#6366f1' : stroke.color;
        ctx.shadowBlur = Math.max(10, stroke.size * 2.8);
        ctx.fillStyle = stroke.color === '#000000' ? '#6366f1' : stroke.color;
        ctx.beginPath();
        ctx.arc(points[0].x, points[0].y, stroke.size * 0.7, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(points[0].x, points[0].y, Math.max(1.5, stroke.size * 0.35), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = stroke.color;
        ctx.beginPath();
        ctx.arc(points[0].x, points[0].y, stroke.size / 2, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (points.length >= 3) {
      const p0 = points[points.length - 3];
      const p1 = points[points.length - 2];
      const p2 = points[points.length - 1];

      const mid1X = (p0.x + p1.x) / 2;
      const mid1Y = (p0.y + p1.y) / 2;
      const mid2X = (p1.x + p2.x) / 2;
      const mid2Y = (p1.y + p2.y) / 2;

      this.renderStrokeSegment(ctx, stroke, p0, p1, mid1X, mid1Y, mid2X, mid2Y);
    } else if (points.length === 2) {
      const p0 = points[0];
      const p1 = points[1];
      this.renderStrokeSegment(ctx, stroke, p0, p1, p0.x, p0.y, p1.x, p1.y);
    }

    ctx.restore();
  }

  private redrawCanvas(): void {
    const ctx = this.drawingCtx;
    ctx.save();
    ctx.resetTransform();
    const dpr = window.devicePixelRatio || 1;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    ctx.translate(this.panOffsetX, this.panOffsetY);
    ctx.scale(this.zoomScale, this.zoomScale);

    for (const stroke of this.strokes) {
      const points = stroke.points;
      if (points.length === 0) continue;

      if (points.length === 1) {
        if (stroke.isEraser) {
          ctx.globalCompositeOperation = 'destination-out';
          ctx.beginPath();
          ctx.arc(points[0].x, points[0].y, stroke.size * 1.9, 0, Math.PI * 2);
          ctx.fill();
        } else if (stroke.style === 'neon') {
          ctx.save();
          ctx.shadowColor = stroke.color === '#000000' ? '#6366f1' : stroke.color;
          ctx.shadowBlur = Math.max(10, stroke.size * 2.8);
          ctx.fillStyle = stroke.color === '#000000' ? '#6366f1' : stroke.color;
          ctx.beginPath();
          ctx.arc(points[0].x, points[0].y, stroke.size * 0.7, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(points[0].x, points[0].y, Math.max(1.5, stroke.size * 0.35), 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        } else {
          ctx.globalCompositeOperation = 'source-over';
          ctx.fillStyle = stroke.color;
          ctx.beginPath();
          ctx.arc(points[0].x, points[0].y, stroke.size / 2, 0, Math.PI * 2);
          ctx.fill();
        }
        continue;
      }

      if (points.length === 2) {
        const p0 = points[0];
        const p1 = points[1];
        this.renderStrokeSegment(ctx, stroke, p0, p1, p0.x, p0.y, p1.x, p1.y);
        continue;
      }

      for (let i = 0; i < points.length - 1; i++) {
        const p0 = i > 0 ? points[i - 1] : points[i];
        const p1 = points[i];
        const p2 = points[i + 1];

        const mid1X = (p0.x + p1.x) / 2;
        const mid1Y = (p0.y + p1.y) / 2;
        const mid2X = (p1.x + p2.x) / 2;
        const mid2Y = (p1.y + p2.y) / 2;

        this.renderStrokeSegment(ctx, stroke, p0, p1, mid1X, mid1Y, mid2X, mid2Y);
      }
    }

    ctx.restore();
  }

  // Undo & Redo
  private undoLastStroke(): void {
    if (this.strokes.length > 0) {
      const removed = this.strokes.pop()!;
      this.redoStack.push(removed);
      this.redrawCanvas();
      this.soundFx.playUndo();
      this.showTemporaryStatusHint('Отменено действие! ↶ (жест 🖕 или Ctrl+Z)');
    } else if (this.undoSnapshot && this.undoSnapshot.length > 0) {
      this.strokes = [...this.undoSnapshot];
      this.undoSnapshot = null;
      this.redrawCanvas();
      this.soundFx.playUndo();
      this.showTemporaryStatusHint('Холст восстановлен! ↶');
    } else {
      this.showTemporaryStatusHint('Нет действий для отмены');
    }
  }

  private redoLastStroke(): void {
    if (this.redoStack.length > 0) {
      const restored = this.redoStack.pop()!;
      this.strokes.push(restored);
      this.redrawCanvas();
      this.soundFx.playRedo();
      this.showTemporaryStatusHint('Действие повторено! ↷ (Ctrl+Y)');
    } else {
      this.showTemporaryStatusHint('Нет действий для повтора');
    }
  }

  // Colors
  private selectColor(color: string, element: HTMLElement): void {
    this.currentColor = color;
    this.isEraserActive = false;
    this.btnEraser.classList.remove('active');
    this.soundFx.playPop();

    // Update all matching color buttons across toolbar and palette drawer
    document.querySelectorAll('.color-btn').forEach((btn) => {
      const btnColor = (btn as HTMLElement).dataset.color;
      btn.classList.toggle('active', btnColor === color);
    });

    // Update active color preview dot in toolbar
    const activeDot = document.getElementById('active-color-dot');
    if (activeDot) {
      activeDot.style.backgroundColor = color;
      if (color === '#000000') {
        activeDot.classList.add('border-zinc-600');
      } else {
        activeDot.classList.remove('border-zinc-600');
      }
    }

    const title = element.getAttribute('title') || color;
    this.showTemporaryStatusHint(`Выбран цвет: ${title}`);
  }

  // Eraser
  private toggleEraser(): void {
    this.isEraserActive = !this.isEraserActive;
    this.soundFx.playPop();
    if (this.isEraserActive) {
      this.btnEraser.classList.add('active');
      document.querySelectorAll('.color-btn').forEach((btn) => btn.classList.remove('active'));
      this.showTemporaryStatusHint('Режим: Ластик 🧽');
    } else {
      this.btnEraser.classList.remove('active');
      const activeColorBtn = document.querySelector(`.color-btn[data-color="${this.currentColor}"]`);
      if (activeColorBtn) {
        activeColorBtn.classList.add('active');
      }
      this.showTemporaryStatusHint('Режим: Кисть 🖌️');
    }
  }

  // Clear Canvas
  private clearCanvas(): void {
    if (this.strokes.length > 0) {
      this.undoSnapshot = [...this.strokes];
      this.strokes = [];
      this.redoStack = [];
      this.redrawCanvas();
      this.soundFx.playClear();
      confetti({
        particleCount: 25,
        spread: 60,
        origin: { y: 0.8 },
        colors: ['#6366f1', '#a855f7', '#10b981'],
      });
      this.showTemporaryStatusHint('Холст очищен (жест 🖕 вернёт назад)');
    }
  }

  // Reset Pan & Zoom
  private resetView(): void {
    this.panOffsetX = 0;
    this.panOffsetY = 0;
    this.zoomScale = 1.0;
    this.updateViewIndicator();
    this.redrawCanvas();
    this.soundFx.playPop();
    this.showTemporaryStatusHint('Масштаб сброшен (1:1)');
  }

  private updateViewIndicator(): void {
    const isTransformed =
      Math.abs(this.zoomScale - 1.0) > 0.02 ||
      Math.abs(this.panOffsetX) > 5 ||
      Math.abs(this.panOffsetY) > 5;

    if (isTransformed) {
      this.viewIndicator.classList.remove('hidden');
      this.viewZoomText.textContent = `${Math.round(this.zoomScale * 100)}%`;
    } else {
      this.viewIndicator.classList.add('hidden');
    }
  }

  // Background Modes
  private setBackgroundMode(mode: 'black' | 'dimmed' | 'camera'): void {
    this.backgroundMode = mode;
    document.body.classList.remove('bg-mode-black', 'bg-mode-dimmed', 'bg-mode-camera');
    document.body.classList.add(`bg-mode-${mode}`);

    if (mode === 'black') {
      this.bgModeIcon.textContent = '🌑';
      this.btnBgMode.title = 'Режим фона: 🌑 Чёрный холст (нажмите для переключения)';
      this.showTemporaryStatusHint('Фон: 🌑 Чистый глубокий чёрный холст (#000000)');
    } else if (mode === 'dimmed') {
      this.bgModeIcon.textContent = '🌓';
      this.btnBgMode.title = 'Режим фона: 🌓 Тёмный силуэт (нажмите для переключения)';
      this.showTemporaryStatusHint('Фон: 🌓 Кинематографичная ночь');
    } else {
      this.bgModeIcon.textContent = '☀️';
      this.btnBgMode.title = 'Режим фона: ☀️ Камера (нажмите для переключения)';
      this.showTemporaryStatusHint('Фон: ☀️ Камера на полную яркость');
    }
    this.soundFx.playPop();
  }

  private toggleBackgroundMode(): void {
    if (this.backgroundMode === 'dimmed') {
      this.setBackgroundMode('black');
    } else if (this.backgroundMode === 'black') {
      this.setBackgroundMode('camera');
    } else {
      this.setBackgroundMode('dimmed');
    }
  }

  // Sound Toggle
  private toggleSound(): void {
    this.soundFx.enabled = !this.soundFx.enabled;
    this.btnSoundToggle.classList.toggle('active', this.soundFx.enabled);
    this.soundIcon.textContent = this.soundFx.enabled ? '🔊' : '🔇';
    if (this.soundFx.enabled) {
      this.soundFx.playPop();
    }
    this.showTemporaryStatusHint(this.soundFx.enabled ? 'Звуковые эффекты: ВКЛ 🔊' : 'Звук: ВЫКЛ 🔇');
  }

  // Save Modal Options & Export
  private openSaveModal(): void {
    this.saveModal.classList.remove('hidden');
    this.soundFx.playPop();
  }

  private closeSaveModal(): void {
    this.saveModal.classList.add('hidden');
  }

  private exportDrawing(mode: 'black' | 'transparent' | 'photo'): void {
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = window.innerWidth;
    exportCanvas.height = window.innerHeight;
    const exportCtx = exportCanvas.getContext('2d')!;

    if (mode === 'black') {
      exportCtx.fillStyle = '#000000';
      exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
      exportCtx.drawImage(this.drawingCanvas, 0, 0, exportCanvas.width, exportCanvas.height);
    } else if (mode === 'transparent') {
      exportCtx.drawImage(this.drawingCanvas, 0, 0, exportCanvas.width, exportCanvas.height);
    } else if (mode === 'photo') {
      if (this.isCameraActive && this.video.videoWidth > 0) {
        exportCtx.save();
        if (this.isMirrored) {
          exportCtx.translate(exportCanvas.width, 0);
          exportCtx.scale(-1, 1);
        }
        exportCtx.drawImage(this.video, 0, 0, exportCanvas.width, exportCanvas.height);
        exportCtx.restore();
      } else {
        exportCtx.fillStyle = '#000000';
        exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
      }
      exportCtx.drawImage(this.drawingCanvas, 0, 0, exportCanvas.width, exportCanvas.height);
    }

    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    const link = document.createElement('a');
    link.download = `handdraw-${mode}-${timestamp}.png`;
    link.href = exportCanvas.toDataURL('image/png');
    link.click();

    this.closeSaveModal();
    this.soundFx.playClear();
    this.showTemporaryStatusHint(`Рисунок сохранён (${mode})! 💾`);
  }

  // Cheatsheet Modal
  private toggleCheatsheetModal(): void {
    const isHidden = this.cheatsheetModal.classList.toggle('hidden');
    this.btnHelpGuide.classList.toggle('active', !isHidden);
    this.soundFx.playPop();
    this.updateCheatsheetActive();
  }

  private updateCheatsheetActive(): void {
    const items = document.querySelectorAll('[data-cheat-gesture]');
    items.forEach((item) => {
      const g = item.getAttribute('data-cheat-gesture');
      item.classList.toggle('active-live', g === this.currentGesture);
    });
  }

  // Status & Gesture State Indicator
  private setGestureState(gesture: GestureType, title: string, hint: string): void {
    this.gestureBadge.className = 'gesture-badge';
    this.statusDot.className = 'status-dot';

    let emoji = '☝️';
    let badgeText = 'Курсор';

    switch (gesture) {
      case 'cursor':
        emoji = '☝️';
        badgeText = 'Курсор';
        this.gestureBadge.classList.add('badge-cursor');
        this.statusDot.classList.add('dot-tracking');
        break;
      case 'draw':
        emoji = '☝️+🖕';
        badgeText = 'Рисование';
        this.gestureBadge.classList.add('badge-draw');
        this.statusDot.classList.add('dot-drawing');
        break;
      case 'move':
        emoji = '✊';
        badgeText = 'Перемещение';
        this.gestureBadge.classList.add('badge-move');
        this.statusDot.classList.add('dot-active');
        break;
      case 'zoom':
        emoji = '✌️';
        badgeText = 'Масштаб';
        this.gestureBadge.classList.add('badge-zoom');
        this.statusDot.classList.add('dot-active');
        break;
      case 'wait':
        emoji = '🖐️';
        badgeText = 'Ожидание';
        this.gestureBadge.classList.add('badge-wait');
        this.statusDot.classList.add('dot-idle');
        break;
      case 'ok':
        emoji = '👌';
        badgeText = 'Выбор';
        this.gestureBadge.classList.add('badge-ok');
        this.statusDot.classList.add('dot-tracking');
        break;
      case 'undo':
        emoji = '🖕';
        badgeText = 'Отмена';
        this.gestureBadge.classList.add('badge-undo');
        this.statusDot.classList.add('dot-active');
        break;
      case 'none':
      default:
        emoji = '📷';
        badgeText = 'Камера';
        this.statusDot.classList.add('dot-idle');
        break;
    }

    this.gestureBadgeEmoji.textContent = emoji;
    this.gestureBadgeTitle.textContent = badgeText;
    this.statusText.textContent = title;
    this.statusHint.textContent = hint;
  }

  private showTemporaryStatusHint(text: string): void {
    const original = this.statusHint.textContent;
    this.statusHint.textContent = text;
    this.statusHint.classList.add('text-indigo-300', 'font-semibold');
    setTimeout(() => {
      this.statusHint.textContent = original;
      this.statusHint.classList.remove('text-indigo-300', 'font-semibold');
    }, 1800);
  }
}

// Boot application
window.addEventListener('DOMContentLoaded', () => {
  new HandDrawApp();
});
