/**
 * Complete Slot Game Integration from slotjs-master
 * Converted from ES6 modules to vanilla JavaScript
 * Integrated with Gambleio balance system
 */

(function() {
  'use strict';
  
  console.log('[slot-integration.js] Script loaded and executing...');

  // ============================================================================
  // CONSTANTS
  // ============================================================================

  const SYMBOLS_CLASSIC = ['🍋', '🍊', '🍉', '🍈', '🍇', '🥝', '🍓', '🍒', '🌟', '🍀', '💎', '🎰'];
  const SYMBOLS_RANDOM = SYMBOLS_CLASSIC;

  const IS_FIREFOX = navigator.userAgent.toLowerCase().includes('firefox');
  const IS_IOS = /iPad|iPhone|iPod/.test(navigator.platform || '');
  const IS_DESKTOP = !navigator.userAgentData?.mobile;

  // ============================================================================
  // UTILITIES
  // ============================================================================

  function createElement(className = '', content = '', angle = null, style = null) {
    const element = document.createElement('DIV');
    element.className = Array.isArray(className) ? className.join(' ') : className;
    if (typeof content === 'string') {
      element.innerText = content;
    } else if (content) {
      element.appendChild(content);
    }
    if (style) {
      element.style.cssText = style;
    }
    if (angle !== null) {
      element.style.transform = `rotate(${angle}deg)`;
    }
    return element;
  }

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; --i) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function capitalize(str = '') {
    const parts = str.toLowerCase().split('-');
    return parts.map((part) => {
      const firstChar = part[0];
      return `${firstChar.toUpperCase()}${part.substring(1)}`;
    }).join(' ');
  }

  let dynamicStyles = null;

  function addAnimation(name, body) {
    if (!dynamicStyles) {
      dynamicStyles = document.createElement('style');
      dynamicStyles.type = 'text/css';
      document.head.appendChild(dynamicStyles);
    }
    dynamicStyles.sheet.insertRule(`@keyframes ${name} { ${body} }`, dynamicStyles.length);
  }

  function resetAnimations() {
    if (dynamicStyles) {
      dynamicStyles.remove();
      dynamicStyles = null;
    }
  }

  function stopAtAnimation(name, start, end, alpha, speed) {
    const angles = [start, end - (alpha * 0.25), end + (alpha * 0.125), end - (alpha * 0.0625), end + (alpha * 0.03125), end - (alpha * 0.015625), end];
    let previousAngle = start;
    let total = 0;
    const time = angles.map((angle) => {
      const delta = Math.max(Math.abs(angle - previousAngle) / Math.abs(speed), 10);
      previousAngle = angle;
      total += delta;
      return delta;
    });
    let previousPercent = 0;
    const percent = time.map((t) => {
      const p = previousPercent + (100 * t / total);
      previousPercent = p;
      return p;
    });
    const animation = percent.map((p, i) => `${Math.round(p)}% { transform: rotate(${angles[i].toFixed(2)}deg); }`).join('\n');
    addAnimation(name, animation);
    return total;
  }

  let tap = false;
  let globalClickCallback = null;

  function setGlobalClickAndTabHandler(cb) {
    globalClickCallback = cb;
    if (IS_IOS) {
      document.ontouchstart = () => { tap = true; };
      document.ontouchmove = () => { tap = false; };
      document.ontouchcancel = () => { tap = false; };
      document.ontouchend = () => { if (tap && cb) { cb(); tap = false; } };
    } else {
      document.onmousedown = cb;
    }
  }

  // ============================================================================
  // SOUND SERVICE (Loaded from original slotjs sound assets)
  // ============================================================================

  class SoundAsset {
    constructor(url) {
      this.url = url;
      this.isLoaded = false;
      this.isErrored = false;
      this.instances = [];
    }

    load() {
      return new Promise((resolve, reject) => {
        const audio = new Audio();
        audio.preload = 'auto';
        audio.src = this.url;
        const handleLoaded = () => {
          this.isLoaded = true;
          cleanup();
          resolve();
        };
        const handleError = () => {
          this.isErrored = true;
          cleanup();
          reject(new Error(`Failed to load sound: ${this.url}`));
        };
        const cleanup = () => {
          audio.removeEventListener('canplaythrough', handleLoaded);
          audio.removeEventListener('error', handleError);
        };
        audio.addEventListener('canplaythrough', handleLoaded, { once: true });
        audio.addEventListener('error', handleError, { once: true });
        audio.load();
      });
    }

    play(volume = 1) {
      if (!this.isLoaded || this.isErrored) return;
      const audio = new Audio(this.url);
      audio.preload = 'auto';
      audio.volume = Math.max(0, Math.min(1, volume));
      this.instances.push(audio);
      audio.onended = () => {
        this.instances = this.instances.filter((instance) => instance !== audio);
      };
      audio.play().catch(() => {});
    }

    stop() {
      this.instances.forEach((audio) => {
        try {
          audio.pause();
          audio.currentTime = 0;
        } catch (_) {}
      });
      this.instances = [];
    }
  }

  class SMSoundServiceClass {
    static EXTENSION = IS_FIREFOX ? 'ogg' : 'mp3';
    static BASE_URL = 'https://raw.githubusercontent.com/Danziger/slotjs/master/static/sounds/';
    static STORAGE_KEY = 'slotVolume';
    static DEFAULT_VOLUME = 0.25;

    constructor() {
      this.isEnabled = true;
      this.soundsStatus = 'loading';
      this.volume = this.loadSavedVolume();

      this.blipSound = new SoundAsset(this.getSoundUrl('blip'));
      this.coinSound = new SoundAsset(this.getSoundUrl('coin'));
      this.stopSound = new SoundAsset(this.getSoundUrl('stop'));
      this.unluckySound = new SoundAsset(this.getSoundUrl('unlucky'));
      this.winSound = new SoundAsset(this.getSoundUrl('win'));

      this.loadSounds();
    }

    getSoundUrl(name) {
      return `${SMSoundServiceClass.BASE_URL}${name}.${SMSoundServiceClass.EXTENSION}`;
    }

    loadSavedVolume() {
      const saved = parseFloat(localStorage.getItem(SMSoundServiceClass.STORAGE_KEY));
      if (!isFinite(saved)) return SMSoundServiceClass.DEFAULT_VOLUME;
      return Math.max(0, Math.min(1, saved));
    }

    loadSounds() {
      this.soundsStatus = 'loading';
      Promise.all([
        this.blipSound.load(),
        this.coinSound.load(),
        this.stopSound.load(),
        this.unluckySound.load(),
        this.winSound.load()
      ]).then(() => {
        this.soundsStatus = 'loaded';
      }).catch(() => {
        this.soundsStatus = 'error';
      });
    }

    setVolume(value) {
      const next = Math.max(0, Math.min(1, value));
      this.volume = next;
      localStorage.setItem(SMSoundServiceClass.STORAGE_KEY, String(next));
      if (next <= 0) {
        this.stopAll();
      }
    }

    getVolume() {
      return this.volume;
    }

    getEffectiveVolume(baseVolume = 1) {
      return Math.max(0, Math.min(1, baseVolume * this.volume));
    }

    canPlay() {
      return this.isEnabled && this.soundsStatus === 'loaded' && this.volume > 0;
    }

    stopAll() {
      this.blipSound.stop();
      this.coinSound.stop();
      this.stopSound.stop();
      this.unluckySound.stop();
      this.winSound.stop();
    }

    enable() {
      this.isEnabled = true;
      if (this.soundsStatus === 'error') {
        this.loadSounds();
      }
    }

    disable() {
      this.isEnabled = false;
      this.stopAll();
    }

    blip(volume = 1) {
      if (!this.canPlay()) return;
      this.blipSound.play(this.getEffectiveVolume(volume));
    }

    coin(volume = 1) {
      if (!this.canPlay()) return;
      this.coinSound.play(this.getEffectiveVolume(volume));
    }

    stop(volume = 1) {
      if (!this.canPlay()) return;
      this.stopSound.play(this.getEffectiveVolume(volume));
    }

    unlucky(volume = 1) {
      if (!this.canPlay()) return;
      this.unluckySound.play(this.getEffectiveVolume(volume));
    }

    win(volume = 1) {
      if (!this.canPlay()) return;
      this.winSound.play(this.getEffectiveVolume(volume));
    }
  }

  const SMSoundService = new SMSoundServiceClass();

  // ============================================================================
  // SLOT MACHINE REEL
  // ============================================================================

  class SlotMachineReel {
    static C_REEL = 'sm__reel';
    static C_CELL = 'sm__cell';
    static C_CELL_SHADOW = 'sm__cell--has-shadow';
    static C_CELL_BLUR = 'sm__cell--has-blur';
    static C_FIGURE = 'sm__figure';
    static C_IS_STOP = 'is-stop';
    static V_INDEX = '--index';
    static STOP_ANIMATION_DURATION_MULTIPLIER = 5;

    constructor(index, alpha, symbols, diameter) {
      this.index = index;
      this.alpha = alpha;
      this.angle = 0;
      this.stopAt = 0;
      const root = this.root = createElement([SlotMachineReel.C_REEL, SlotMachineReel.C_IS_STOP]);
      this.style = root.style;
      root.style.willChange = 'transform';
      this.style.setProperty(SlotMachineReel.V_INDEX, index);

      if (!symbols) return;

      const cellShadowClasses = IS_FIREFOX 
        ? [SlotMachineReel.C_CELL, SlotMachineReel.C_CELL_SHADOW]
        : [SlotMachineReel.C_CELL, SlotMachineReel.C_CELL_SHADOW, SlotMachineReel.C_CELL_BLUR];
      const shadowOpacityWeight = IS_FIREFOX ? 0.5 : 1;
      const shadowCount = this.shadowCount = Math.max(2, Math.round((diameter - 0.5 - (2 * index)) * Math.PI / symbols.length));
      const beta = 1 / shadowCount;
      const shuffledSymbols = [...symbols];
      shuffle(shuffledSymbols);

      shuffledSymbols.forEach((symbol, symbolIndex) => {
        const cellFigure = createElement(SlotMachineReel.C_FIGURE, symbol);
        const cell = createElement(SlotMachineReel.C_CELL, cellFigure, symbolIndex * alpha);
        root.appendChild(cell);

        for (let shadowIndex = 1; shadowIndex < shadowCount; ++shadowIndex) {
          root.appendChild(createElement(
            cellShadowClasses,
            cellFigure.cloneNode(true),
            alpha * (symbolIndex + (beta * shadowIndex)),
            `opacity: ${shadowOpacityWeight * (1 - (beta * shadowIndex))};`
          ));
        }
      });
    }

    reset() {
      this.root.classList.remove('is-stop');
      this.angle = (360 - this.stopAt) % 360;
      this.root.style.setProperty('transform', `rotate(${this.angle}deg)`);
      this.root.style.animation = '';
      this.stopAt = 0;
    }

    stop(speed, deltaAlpha) {
      const angle = (360 - this.angle - deltaAlpha) % 360;
      const index = Math.ceil(angle / this.alpha);
      const stopAt = index * this.alpha;
      const animationName = `stop-${this.index}`;
      const animationDuration = stopAtAnimation(
        animationName,
        (360 - angle) % 360,
        (360 - stopAt) % 360,
        this.alpha,
        speed
      ) * SlotMachineReel.STOP_ANIMATION_DURATION_MULTIPLIER;

      this.stopAt = stopAt;
      this.root.style.setProperty('animation', `${animationName} ${animationDuration}ms ease-out forwards`);
      this.root.classList.add(SlotMachineReel.C_IS_STOP);
      return (this.root.children[index * this.shadowCount] || this.root.children[0]).innerText;
    }
  }

  // ============================================================================
  // SLOT MACHINE
  // ============================================================================

  class SlotMachine {
    static C_HAS_ZOOM = 'has-zoom';
    static C_IS_WIN = 'is-win';
    static C_IS_FAIL = 'is-fail';
    static S_BASE = '.sm__base';
    static S_REELS_CONTAINER = '.sm__reelsContainer';
    static S_DISPLAY = '.sm__display';
    static V_WRAPPER_SIZE = '--wrapperSize';
    static V_REEL_SIZE = '--reelSize';
    static V_DISPLAY_SIZE = '--displaySize';
    static V_DISPLAY_ZOOM = '--displayZoom';
    static V_SHADOW_WEIGHT = '--shadowWeight';
    static UNITS_CENTER = 3;
    static UNITS_MARGIN = 1;
    static UNITS_TOTAL = SlotMachine.UNITS_CENTER + SlotMachine.UNITS_MARGIN;
    static ZOOM_TRANSITION = 'transform ease-in-out 500ms 250ms';
    static ZOOM_TRANSITION_DURATION = 1000;
    static BLIP_RATE = 4;
    static FIREFOX_SHADOW_WEIGHT = 0.5;
    static APP_PADDING = 16;

    // Elements - must exist in HTML
    wrapper;
    root = document.querySelector(SlotMachine.S_BASE);
    reelsContainer = document.querySelector(SlotMachine.S_REELS_CONTAINER);
    display = document.querySelector(SlotMachine.S_DISPLAY);
    reels = [];

    constructor(wrapper, handleUseCoin, handleGetPrice, reelCount, symbols, isPaused, speed) {
      console.log('[SlotMachine.constructor] Called with:', {
        wrapper: !!wrapper,
        reelCount,
        symbolsCount: symbols.length,
        isPaused,
        speed
      });
      
      try {
        this.wrapper = wrapper;
        this.handleUseCoin = handleUseCoin;
        this.handleGetPrice = handleGetPrice;
        this.reelCount = reelCount;
        this.symbols = symbols;
        this.speed = speed || -0.552;
        this.blipFading = 1 / reelCount;
        this.currentCombination = [];
        this.currentReel = null;
        this.blipCounter = 0;
        this.lastUpdate = 0;
        this.isPaused = false;
        this.zoomTransitionTimeoutID = null;
        this.keydownTimeoutID = null;
        this.keydownLastCalled = 0;

        console.log('[SlotMachine.constructor] Calling init()...');
        this.init(wrapper, handleUseCoin, handleGetPrice, reelCount, symbols, speed);
        console.log('[SlotMachine.constructor] init() completed');
        
        window.onresize = this.handleResize.bind(this);
        document.onkeydown = this.handleKeyDown.bind(this);
        document.onkeyup = this.handleKeyUp.bind(this);
        this.handleClick = this.handleClick.bind(this);

        if (isPaused) {
          console.log('[SlotMachine.constructor] Pausing...');
          this.pause();
        } else {
          console.log('[SlotMachine.constructor] Resuming...');
          this.resume();
        }
        
        console.log('[SlotMachine.constructor] Constructor completed successfully');
      } catch(e) {
        console.error('[SlotMachine.constructor] ERROR in constructor:', e);
        console.error('[SlotMachine.constructor] Stack:', e.stack);
        throw e;
      }
    }

    init(wrapper, handleUseCoin, handleGetPrice, reelCount, symbols, speed) {
      console.log('SlotMachine.init() called', { wrapper, reelCount, symbols: symbols.length });
      
      this.wrapper = wrapper;
      this.handleUseCoin = handleUseCoin;
      this.handleGetPrice = handleGetPrice;
      this.reelCount = reelCount;
      this.symbols = symbols;
      this.speed = speed;
      this.blipFading = 1 / reelCount;

      // Elements should already exist from class definition, but verify
      if (!this.root) {
        this.root = document.querySelector(SlotMachine.S_BASE);
      }
      if (!this.reelsContainer) {
        this.reelsContainer = document.querySelector(SlotMachine.S_REELS_CONTAINER);
      }
      if (!this.display) {
        this.display = document.querySelector(SlotMachine.S_DISPLAY);
      }

      console.log('Elements found:', {
        root: !!this.root,
        reelsContainer: !!this.reelsContainer,
        display: !!this.display,
        wrapper: !!this.wrapper,
        wrapperSize: this.wrapper ? { w: this.wrapper.offsetWidth, h: this.wrapper.offsetHeight } : null
      });

      if (!this.root || !this.reelsContainer) {
        console.error('Slot machine elements not found in HTML. Required: .sm__base, .sm__reelsContainer, .sm__display');
        return;
      }

      const alpha = this.alpha = 360 / symbols.length;
      const shuffledSymbols = [...symbols];
      const diameter = (2 * reelCount) + SlotMachine.UNITS_CENTER;

      console.log('Calculated values:', { alpha, diameter, reelCount });

      // Sets --reelSize and --displaySize:
      this.resize();

      if (IS_FIREFOX) {
        this.root.style.setProperty(SlotMachine.V_SHADOW_WEIGHT, SlotMachine.FIREFOX_SHADOW_WEIGHT);
      }

      // Clear and create reels
      this.reelsContainer.innerHTML = '';
      this.reels = [];
      
      console.log('Creating reels...');
      for (let reelIndex = 0; reelIndex < reelCount; ++reelIndex) {
        const reel = new SlotMachineReel(reelIndex, alpha, shuffledSymbols, diameter);
        this.reelsContainer.appendChild(reel.root);
        this.reels.push(reel);
      }
      
      // Add cover reel
      this.reelsContainer.appendChild(new SlotMachineReel(reelCount).root);
      
      console.log('Reels created:', this.reels.length, 'reels + 1 cover reel');
      console.log('ReelsContainer children:', this.reelsContainer.children.length);
    }

    resize() {
      const { wrapper, root, reelCount, display } = this;
      if (!wrapper || !root || !display) {
        console.log('Resize: missing elements', { wrapper: !!wrapper, root: !!root, display: !!display });
        requestAnimationFrame(() => this.resize());
        return;
      }
      
      const { style } = root;
      const { offsetWidth, offsetHeight } = wrapper;
      const wrapperSize = Math.min(offsetWidth, offsetHeight) - SlotMachine.APP_PADDING;
      const reelSize = wrapperSize / ((2 * reelCount) + SlotMachine.UNITS_TOTAL) | 0;

      console.log('Resize calculation:', {
        wrapperSize: { w: offsetWidth, h: offsetHeight },
        calculatedWrapperSize: wrapperSize,
        reelSize,
        rootSize: { w: root.offsetWidth, h: root.offsetHeight },
        displaySize: { w: display.offsetWidth, h: display.offsetHeight }
      });

      if (wrapperSize <= 0 || reelSize <= 0) {
        console.log('Resize: invalid sizes, retrying...');
        requestAnimationFrame(() => this.resize());
        return;
      }

      const displayZoom = root.offsetWidth / display.offsetWidth;
      if (displayZoom <= 0 || !isFinite(displayZoom)) {
        console.log('Resize: invalid zoom, retrying...', { displayZoom });
        requestAnimationFrame(() => this.resize());
        return;
      }

      style.setProperty(SlotMachine.V_WRAPPER_SIZE, `${wrapperSize}px`);
      style.setProperty(SlotMachine.V_REEL_SIZE, `${reelSize}px`);
      style.setProperty(SlotMachine.V_DISPLAY_SIZE, `${reelSize * reelCount}px`);
      style.setProperty(SlotMachine.V_DISPLAY_ZOOM, `${displayZoom}`);
      
      console.log('Resize complete:', {
        wrapperSize: `${wrapperSize}px`,
        reelSize: `${reelSize}px`,
        displaySize: `${reelSize * reelCount}px`,
        zoom: displayZoom
      });
    }

    start() {
      // handleUseCoin is called by the spin button before start() so bet is applied (and awaited) first
      this.currentCombination = [];
      this.currentReel = 0;
      if (this.display) {
        this.display.classList.remove(SlotMachine.C_IS_WIN, SlotMachine.C_IS_FAIL);
      }
      this.reels.forEach((reel) => reel.reset());
      resetAnimations();

      if (typeof SMSoundService.coin === 'function') { try { SMSoundService.coin(); } catch (_) {} }
      
      this.lastUpdate = performance.now();
      setGlobalClickAndTabHandler(this.handleClick.bind(this));
      this.tick();
    }

    stop() {
      const currentPrize = this.checkPrize();
      this.currentReel = null;
      setGlobalClickAndTabHandler(null);

      if (currentPrize && this.display) {
        SMSoundService.win();
        this.display.classList.add(SlotMachine.C_IS_WIN);
        if (this.handleGetPrice) this.handleGetPrice(currentPrize);
      } else if (this.display) {
        SMSoundService.unlucky();
        this.display.classList.add(SlotMachine.C_IS_FAIL);
      }
      
      // Re-enable spin button
      const spinBtn = document.getElementById('slotSpinBtn');
      if (spinBtn) {
        spinBtn.disabled = false;
        spinBtn.textContent = 'Spin';
      }
      if (window.SlotIntegration) {
        window.SlotIntegration.setIsSpinning(false);
      }
    }

    tick() {
      if (this.currentReel === null || this.isPaused) {
        requestAnimationFrame(() => this.tick());
        return;
      }

      const now = performance.now();
      const deltaTime = now - this.lastUpdate;
      const deltaAlpha = deltaTime * this.speed;

      this.blipCounter = (this.blipCounter + 1) % SlotMachine.BLIP_RATE;
      if (this.blipCounter === 0 && typeof SMSoundService.blip === 'function') {
        try { SMSoundService.blip(1 - (this.blipFading * this.currentReel)); } catch (_) {}
      }

      this.lastUpdate = now;

      const reels = this.reels;
      const cur = this.currentReel;
      for (let i = reels.length - 1; i >= cur; --i) {
        const reel = reels[i];
        if (!reel || !reel.root) continue;
        const a = (reel.angle == null ? 0 : reel.angle) + deltaAlpha;
        reel.angle = (360 + a) % 360;
        reel.root.style.setProperty('transform', `rotate(${reel.angle}deg)`);
      }

      requestAnimationFrame(() => this.tick());
    }

    zoomIn() { this.zoom(); }
    zoomOut() { this.zoom(true); }

    zoom(out = false) {
      clearTimeout(this.zoomTransitionTimeoutID);
      this.root.style.transition = SlotMachine.ZOOM_TRANSITION;
      this.root.classList[out ? 'remove' : 'add'](SlotMachine.C_HAS_ZOOM);
      this.zoomTransitionTimeoutID = setTimeout(() => {
        this.root.style.transition = '';
      }, SlotMachine.ZOOM_TRANSITION_DURATION);
    }

    stopReel(reelIndex) {
      const deltaAlpha = (performance.now() - this.lastUpdate) * this.speed;
      this.currentCombination.push(this.reels[reelIndex].stop(this.speed, deltaAlpha));
      SMSoundService.stop();
    }

    checkPrize() {
      const { currentCombination, reelCount, symbols } = this;
      const occurrencesCount = {};
      let maxOccurrences = 0;
      let lastSymbol = '';
      let maxSymbol = '';

      for (let i = 0; i < reelCount; ++i) {
        const symbol = currentCombination[i];
        const occurrences = occurrencesCount[symbol] = (lastSymbol === symbol ? occurrencesCount[symbol] + 1 : 1);
        lastSymbol = symbol;
        if (occurrences > maxOccurrences) {
          maxOccurrences = occurrences;
          const index = symbols.indexOf(symbol);
          const maxIndex = symbols.indexOf(maxSymbol);
          if (index > maxIndex) maxSymbol = symbol;
        }
      }

      if (maxOccurrences < 3) return null;
      const total = symbols.length;
      const idx = symbols.indexOf(maxSymbol);
      const figureWeight = (idx + 1) / total;
      if (maxOccurrences >= 5) return 1000 + 9000 * figureWeight;
      if (maxOccurrences >= 4) return 100 + 900 * figureWeight;
      return 10 + 40 * figureWeight;
    }

    handleResize() {
      requestAnimationFrame(() => this.resize());
    }

    handleKeyDown(e) {
      window.clearTimeout(this.keydownTimeoutID);
      const { key } = e;
      if (this.isPaused || document.activeElement !== document || ![' ', 'Enter'].includes(key)) return;
      const elapsed = Date.now() - this.keydownLastCalled;
      if (elapsed >= 1000) {
        this.handleClick();
      } else {
        this.keydownTimeoutID = window.setTimeout(this.handleClick.bind(this), 1000 - elapsed);
      }
    }

    handleKeyUp(e) {
      if (![' ', 'Enter'].includes(e.key)) return;
      window.clearTimeout(this.keydownTimeoutID);
      this.keydownLastCalled = 0;
    }

    handleClick(e = null) {
      window.clearTimeout(this.keydownTimeoutID);
      this.keydownLastCalled = Date.now();

      if (e) {
        const { target } = e;
        const targetTagName = target.tagName;
        const parentTagName = target.parentElement?.tagName;
        if (/^A|BUTTON$/.test(targetTagName) || /^A|BUTTON$/.test(parentTagName)) {
          document.activeElement.blur();
          return;
        }
        if (e.which === 3) return;
      }

      if (this.currentReel === null) {
        return;
      } else if (this.currentReel < this.reels.length) {
        this.stopReel(this.currentReel);
        ++this.currentReel;
        if (this.currentReel >= this.reels.length) {
          this.stop();
        }
      }
    }

    pause() {
      setGlobalClickAndTabHandler(null);
      this.isPaused = true;
    }

    resume() {
      if (this.currentReel !== null) {
        setGlobalClickAndTabHandler(this.handleClick);
      }
      this.isPaused = false;
      if (this.currentReel !== null) requestAnimationFrame(() => this.tick());
    }
  }

  // ============================================================================
  // PAY TABLE
  // ============================================================================

  class PayTable {
    constructor(symbols) {
      this.root = document.querySelector('#payTableBase');
      this.payMatrix = {};
      this.activeColumn = null;
      if (this.root) this.init(symbols);
    }

    init(symbols) {
      const total = symbols.length;
      const headerHTML = `
        <li class="pt__header">
          <div class="pt__rowContent">
            <span class="pt__c1"></span>
            <button class="pt__c2 pt__tab"><span class="pt__tabText">× 3</span></button>
            <button class="pt__c3 pt__tab"><span class="pt__tabText">× 4</span></button>
            <button class="pt__c4 pt__tab"><span class="pt__tabText">× 5</span></button>
          </div>
        </li>
      `;

      this.root.innerHTML = headerHTML + symbols.map((symbol, i) => {
        const figureWeight = (i + 1) / total;
        const mult3 = Math.round(10 + 40 * figureWeight);
        const mult4 = Math.round(100 + 900 * figureWeight);
        const mult5 = Math.round(1000 + 9000 * figureWeight);
        this.payMatrix[symbol] = [mult3, mult4, mult5];
        return `
          <li class="pt__row">
            <div class="pt__rowContent">
              <span class="pt__c1">${symbol}</span>
              <span class="pt__c2">${mult3}×</span>
              <span class="pt__c3">${mult4}×</span>
              <span class="pt__c4">${mult5}×</span>
            </div>
          </li>
        `;
      }).join('');

      this.activeColumn = this.root.querySelector('.pt__header .pt__c2');
      const header = this.root.querySelector('.pt__header');
      if (header) {
        header.addEventListener('click', this.handleColumnClicked.bind(this));
      }
    }

    handleColumnClicked({ target }) {
      const column = parseInt(target.className.replace('pt__c', ''), 10) || 0;
      if (column <= 1 || target === this.activeColumn) return;
      this.activeColumn = target;
      this.root.className = `pt__base pt__base--activeC${column}`;
      document.activeElement.blur();
    }
  }

  // ============================================================================
  // MODAL
  // ============================================================================

  class Modal {
    static OPEN_MODAL = null;
    static C_IS_OPEN = 'is-open';

    constructor(selectorRoot, selectorButton, key, isOpen, isFixed, onModalToggled) {
      this.root = document.querySelector(selectorRoot);
      if (!this.root) return;
      
      this.closeButton = this.root.querySelector('.modal__button');
      this.key = key;
      this.onModalToggled = onModalToggled;
      this.isOpen = false;
      this.isFixed = false;

      if (this.closeButton) {
        this.closeButton.onclick = (e) => {
          e.stopPropagation();
          document.activeElement.blur();
          this.close('close');
        };
      }

      this.handleKeyDown = this.handleKeyDown.bind(this);
      this.handleClickOutside = this.handleClickOutside.bind(this);

      const button = document.querySelector(selectorButton);
      if (button) {
        button.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.toggle('toggle');
        });
      }

      if (isOpen) {
        this.open('init', isFixed);
      } else {
        this.close('init');
      }
    }

    handleKeyDown({ key }) {
      if (!this.isFixed && (key === 'Esc' || key === 'Escape')) this.close('esc');
    }

    handleClickOutside({ target }) {
      if (this.isFixed || target === this.root || this.root.contains(target)) return;
      this.close('outside');
    }

    open(key, isFixed) {
      if (Modal.OPEN_MODAL) Modal.OPEN_MODAL.close();
      Modal.OPEN_MODAL = this;
      if (isFixed) this.setFixed();
      this.root.classList.add(Modal.C_IS_OPEN);
      this.isOpen = true;
      this.isFixed = isFixed;
      if (this.onModalToggled) this.onModalToggled(true, `${this.key}-${key}`);
      this.addEventListeners();
    }

    close(key) {
      Modal.OPEN_MODAL = null;
      this.removeEventListeners();
      this.root.classList.remove(Modal.C_IS_OPEN);
      if (this.isFixed) this.setDismissible();
      this.isOpen = false;
      this.isFixed = false;
      if (this.onModalToggled) this.onModalToggled(false, `${this.key}-${key}`);
    }

    toggle(key) {
      if (this.isOpen) {
        this.close(key);
      } else {
        this.open(key);
      }
    }

    setFixed() {
      if (this.closeButton) this.closeButton.setAttribute('hidden', true);
    }

    setDismissible() {
      if (this.closeButton) this.closeButton.removeAttribute('hidden');
    }

    addEventListeners() {
      document.addEventListener('keydown', this.handleKeyDown);
      document.addEventListener('click', this.handleClickOutside);
    }

    removeEventListeners() {
      document.removeEventListener('keydown', this.handleKeyDown);
      document.removeEventListener('click', this.handleClickOutside);
    }
  }

  // ============================================================================
  // TOGGLE BUTTON
  // ============================================================================

  class ToggleButton {
    static C_IS_DISABLED = 'is-disabled';

    constructor(selector, key, initialValue, onButtonClick) {
      this.root = document.querySelector(selector);
      if (!this.root) return;
      this.icon = this.root.children[0];
      this.key = key;
      this.onButtonClick = onButtonClick;
      if (initialValue) {
        this.enable();
      } else {
        this.disable();
      }
      this.root.onclick = this.handleButtonClicked.bind(this);
    }

    enable() {
      const label = capitalize(this.key);
      this.root.classList.remove(ToggleButton.C_IS_DISABLED);
      this.root.setAttribute('title', `Turn ${label} Off`);
      this.root.setAttribute('aria-label', `Turn ${label} Off`);
      if (this.icon) this.icon.setAttribute('aria-label', `${label} Is On`);
      this.value = true;
      if (this.onButtonClick) this.onButtonClick(this.key, true);
    }

    disable() {
      const label = capitalize(this.key);
      this.root.classList.add(ToggleButton.C_IS_DISABLED);
      this.root.setAttribute('title', `Turn ${label} On`);
      this.root.setAttribute('aria-label', `Turn ${label} On`);
      if (this.icon) this.icon.setAttribute('aria-label', `${label} Is Off`);
      this.value = false;
      if (this.onButtonClick) this.onButtonClick(this.key, false);
    }

    toggle() {
      if (this.value) {
        this.disable();
      } else {
        this.enable();
      }
    }

    handleButtonClicked(e) {
      e.stopPropagation();
      document.activeElement.blur();
      this.toggle();
    }
  }

  // ============================================================================
  // SLOT GAME INTEGRATION
  // ============================================================================

  let slotMachine = null;
  let payTable = null;
  let instructionsModal = null;
  let payTableModal = null;
  let currentBet = 10;
  let isSpinning = false;
  const SLOT_BET_MIN = 0;
  const SLOT_BET_MAX = 2000;

  function createBetValues() {
    const values = [0];
    for (let v = 10; v <= 100; v += 10) values.push(v);
    for (let v = 125; v <= 500; v += 25) values.push(v);
    for (let v = 550; v <= 1000; v += 50) values.push(v);
    for (let v = 1100; v <= SLOT_BET_MAX; v += 100) values.push(v);
    return values;
  }

  const SLOT_BET_VALUES = createBetValues();

  function getIncreaseStep(value) {
    if (value < 100) return 10;
    if (value < 500) return 25;
    if (value < 1000) return 50;
    return 100;
  }

  function getDecreaseStep(value) {
    if (value <= 100) return 10;
    if (value <= 500) return 25;
    if (value <= 1000) return 50;
    return 100;
  }

  function clampBet(value) {
    if (!isFinite(value)) return currentBet;
    return Math.min(SLOT_BET_MAX, Math.max(SLOT_BET_MIN, value));
  }

  function formatBetValue(value) {
    return formatDollars(value);
  }

  function updateBetUi() {
    const betInput = document.getElementById('slotBet');
    const betValueBtn = document.getElementById('slotBetValueBtn');
    const popupGrid = document.getElementById('slotBetPopupGrid');

    if (betInput) betInput.value = String(currentBet);
    if (betValueBtn) betValueBtn.textContent = formatBetValue(currentBet);

    if (popupGrid) {
      const options = popupGrid.querySelectorAll('.slot-bet-option');
      options.forEach((btn) => {
        const optionBet = parseInt(btn.dataset.bet || '0', 10);
        btn.classList.toggle('is-active', optionBet === currentBet);
      });
    }
  }

  function setCurrentBetValue(value) {
    currentBet = clampBet(Math.round(value));
    updateBetUi();
  }

  function changeBet(direction) {
    const step = direction > 0 ? getIncreaseStep(currentBet) : getDecreaseStep(currentBet);
    const next = currentBet + (direction > 0 ? step : -step);
    setCurrentBetValue(next);
  }

  function hideBetPopup() {
    const popup = document.getElementById('slotBetPopup');
    const toggleBtn = document.getElementById('slotBetValueBtn');
    if (!popup) return;
    popup.classList.add('hidden');
    if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'false');
  }

  function showBetPopup() {
    const popup = document.getElementById('slotBetPopup');
    const toggleBtn = document.getElementById('slotBetValueBtn');
    if (!popup) return;
    popup.classList.remove('hidden');
    if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'true');
  }

  function setupBetControls() {
    const betDown = document.getElementById('slotBetDown');
    const betUp = document.getElementById('slotBetUp');
    const betValueBtn = document.getElementById('slotBetValueBtn');
    const popup = document.getElementById('slotBetPopup');
    const popupGrid = document.getElementById('slotBetPopupGrid');
    const popupClose = document.getElementById('slotBetPopupClose');
    const popupCard = popup ? popup.querySelector('.slot-bet-popup-card') : null;
    const betInput = document.getElementById('slotBet');

    if (!betDown || !betUp || !betValueBtn || !popup || !popupGrid || !popupClose || !betInput) return;

    const inputValue = parseFloat(betInput.value);
    if (isFinite(inputValue)) {
      currentBet = clampBet(inputValue);
    }

    popupGrid.innerHTML = SLOT_BET_VALUES.map((value) =>
      `<button type="button" class="slot-bet-option" data-bet="${value}">${formatBetValue(value)}</button>`
    ).join('');

    betDown.onclick = () => changeBet(-1);
    betUp.onclick = () => changeBet(1);
    betValueBtn.onclick = () => {
      const isHidden = popup.classList.contains('hidden');
      if (isHidden) {
        showBetPopup();
      } else {
        hideBetPopup();
      }
    };

    popupClose.onclick = () => hideBetPopup();
    popup.onclick = (e) => {
      if (e.target === popup) hideBetPopup();
    };
    if (popupCard) {
      popupCard.onclick = (e) => e.stopPropagation();
    }

    popupGrid.onclick = (e) => {
      const optionBtn = e.target.closest('.slot-bet-option');
      if (!optionBtn) return;
      const value = parseInt(optionBtn.dataset.bet || '0', 10);
      setCurrentBetValue(value);
      hideBetPopup();
    };

    betInput.oninput = (e) => {
      const val = parseFloat(e.target.value);
      if (!isNaN(val)) setCurrentBetValue(val);
    };

    setCurrentBetValue(currentBet);
  }

  function formatDollars(n) {
    return '$' + new Intl.NumberFormat('en', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n);
  }

  function refreshSlotGameInfo() {
    const betInput = document.getElementById('slotBet');
    if (betInput && !isSpinning) {
      const parsed = parseFloat(betInput.value);
      if (isFinite(parsed)) {
        currentBet = clampBet(parsed);
      }
    }
    updateBetUi();
    var balanceEl = document.getElementById('balance');
    if (balanceEl && typeof Game !== 'undefined' && Game.getBalance) {
      balanceEl.textContent = formatDollars(Game.getBalance());
    }
    if (window.Auth && window.Auth.updateBalance) window.Auth.updateBalance();
    if (window.Auth && window.Auth.updateProfileBalance) window.Auth.updateProfileBalance();
  }

  async function handleUseCoin() {
    const bet = window.SlotIntegration ? window.SlotIntegration.getCurrentBet() : currentBet;
    if (typeof Game === 'undefined' || !Game.canBet(bet)) {
      alert('Insufficient balance');
      throw new Error('Insufficient balance');
    }
    const placeResult = window.Stats && window.Stats.placeBet
      ? await window.Stats.placeBet(bet)
      : (Game.placeBet(bet) ? { balance: Game.balance } : null);
    if (!placeResult) {
      alert('Insufficient balance or server error');
      throw new Error('Insufficient balance');
    }
    if (!window.Stats || !window.Stats.placeBet) Game.recordBet();
    refreshSlotGameInfo();
  }

  async function handleGetPrice(multiplier) {
    if (multiplier <= 0 || !isFinite(multiplier)) return;
    const bet = window.SlotIntegration ? window.SlotIntegration.getCurrentBet() : currentBet;
    const winAmount = bet * multiplier;
    if (window.Stats && window.Stats.win) {
      await window.Stats.win(winAmount, multiplier, bet);
    } else if (typeof Game !== 'undefined' && Game.win) {
      Game.win(winAmount, multiplier, bet);
    }
    if (window.Auth && window.Auth.updateBalance) window.Auth.updateBalance();
    if (window.Auth && window.Auth.updateProfileStats) window.Auth.updateProfileStats();
    refreshSlotGameInfo();
  }

  function handleModalToggle(isOpen, key) {
    if (!slotMachine || key.includes('-init')) return;
    if (isOpen) {
      slotMachine.pause();
    } else {
      slotMachine.resume();
    }
  }

  function setupVolumeSlider() {
    const soundBtn = document.getElementById('slotSoundBtn');
    const soundIcon = document.getElementById('slotSoundIcon');
    const panel = document.getElementById('slotVolumePanel');
    const slider = document.getElementById('slotVolumeSlider');
    const valueEl = document.getElementById('slotVolumeValue');
    if (!soundBtn || !soundIcon || !panel || !slider || !valueEl) return;

    const isPanelOpen = () => !panel.classList.contains('hidden');
    const closePanel = () => panel.classList.add('hidden');
    const openPanel = () => panel.classList.remove('hidden');

    const getVolumeIcon = (value01) => {
      if (value01 <= 0) return '🔇';
      if (value01 < 0.5) return '🔉';
      return '🔊';
    };

    const updateVolumeUi = (value01) => {
      const percent = Math.round(value01 * 100);
      slider.value = String(percent);
      valueEl.textContent = `${percent}%`;
      soundIcon.textContent = getVolumeIcon(value01);
    };

    const initialVolume = SMSoundService.getVolume();
    updateVolumeUi(initialVolume);

    const onVolumeChanged = () => {
      const value01 = Math.max(0, Math.min(1, (parseFloat(slider.value) || 0) / 100));
      SMSoundService.setVolume(value01);
      updateVolumeUi(value01);
    };

    soundBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (isPanelOpen()) {
        closePanel();
      } else {
        openPanel();
      }
    };

    soundBtn.onmousedown = (e) => e.stopPropagation();
    panel.onmousedown = (e) => e.stopPropagation();
    panel.onclick = (e) => e.stopPropagation();
    slider.onmousedown = (e) => e.stopPropagation();

    if (!setupVolumeSlider._outsideClickHandler) {
      setupVolumeSlider._outsideClickHandler = (e) => {
        const activePanel = document.getElementById('slotVolumePanel');
        const activeBtn = document.getElementById('slotSoundBtn');
        if (!activePanel || !activeBtn) return;
        if (!activePanel.contains(e.target) && !activeBtn.contains(e.target)) {
          activePanel.classList.add('hidden');
        }
      };
      document.addEventListener('click', setupVolumeSlider._outsideClickHandler);
    }

    slider.oninput = onVolumeChanged;
    slider.onchange = onVolumeChanged;
  }

  function initializeSlotGame() {
    console.log('[initializeSlotGame] ========================================');
    console.log('[initializeSlotGame] Function called at:', new Date().toISOString());
    console.log('[initializeSlotGame] Stack trace:', new Error().stack);
    
    const slotGameArea = document.getElementById('slotGameArea');
    const slotGameFooter = document.getElementById('slotGameFooter');
    
    console.log('[initializeSlotGame] Elements found:', {
      slotGameArea: !!slotGameArea,
      slotGameFooter: !!slotGameFooter
    });
    
    if (!slotGameArea) {
      console.error('[initializeSlotGame] ERROR: Slot game area not found!');
      console.error('[initializeSlotGame] Available IDs:', Array.from(document.querySelectorAll('[id]')).map(el => el.id));
      return;
    }

    console.log('[initializeSlotGame] Slot game area details:', {
      element: slotGameArea,
      offsetWidth: slotGameArea.offsetWidth,
      offsetHeight: slotGameArea.offsetHeight,
      computedStyle: {
        display: window.getComputedStyle(slotGameArea).display,
        visibility: window.getComputedStyle(slotGameArea).visibility,
        opacity: window.getComputedStyle(slotGameArea).opacity
      },
      classList: Array.from(slotGameArea.classList),
      parentElement: slotGameArea.parentElement ? {
        id: slotGameArea.parentElement.id,
        classList: Array.from(slotGameArea.parentElement.classList)
      } : null
    });

    // Ensure slot game area is visible
    const pageSlotGame = document.getElementById('page-slot-game');
    console.log('[initializeSlotGame] Page slot-game element:', {
      found: !!pageSlotGame,
      classList: pageSlotGame ? Array.from(pageSlotGame.classList) : [],
      computedStyle: pageSlotGame ? {
        display: window.getComputedStyle(pageSlotGame).display,
        visibility: window.getComputedStyle(pageSlotGame).visibility
      } : null
    });
    
    if (pageSlotGame) {
      const hadHidden = pageSlotGame.classList.contains('hidden');
      pageSlotGame.classList.remove('hidden');
      console.log('[initializeSlotGame] Page slot-game hidden class removed:', {
        hadHidden,
        nowHasHidden: pageSlotGame.classList.contains('hidden'),
        computedDisplay: window.getComputedStyle(pageSlotGame).display
      });
    } else {
      console.error('[initializeSlotGame] ERROR: page-slot-game element not found!');
    }

    // Ensure base elements exist and are visible
    console.log('[initializeSlotGame] Searching for slot machine elements...');
    const base = document.querySelector('.sm__base') || document.getElementById('slotMachineBase');
    const container = base ? base.querySelector('.sm__reelsContainer') : null;
    const display = base ? base.querySelector('.sm__display') : null;
    
    console.log('[initializeSlotGame] HTML elements check:', {
      base: {
        found: !!base,
        id: base ? base.id : null,
        classList: base ? Array.from(base.classList) : [],
        computedStyle: base ? {
          display: window.getComputedStyle(base).display,
          visibility: window.getComputedStyle(base).visibility,
          opacity: window.getComputedStyle(base).opacity,
          width: window.getComputedStyle(base).width,
          height: window.getComputedStyle(base).height
        } : null
      },
      container: {
        found: !!container,
        id: container ? container.id : null,
        classList: container ? Array.from(container.classList) : []
      },
      display: {
        found: !!display,
        id: display ? display.id : null,
        classList: display ? Array.from(display.classList) : []
      }
    });
    
    if (!base || !container || !display) {
      console.error('[initializeSlotGame] ERROR: Slot machine HTML structure missing!');
      console.error('[initializeSlotGame] Required elements: .sm__base, .sm__reelsContainer, .sm__display');
      console.error('[initializeSlotGame] All .sm__base elements:', document.querySelectorAll('.sm__base').length);
      console.error('[initializeSlotGame] All .sm__reelsContainer elements:', document.querySelectorAll('.sm__reelsContainer').length);
      console.error('[initializeSlotGame] All .sm__display elements:', document.querySelectorAll('.sm__display').length);
      return;
    }

    // Clean up existing slot machine instance
    if (slotMachine) {
      try {
        slotMachine.pause();
      } catch(e) {
        console.error('Error pausing existing slot machine:', e);
      }
      slotMachine = null;
    }

    // Show footer
    if (slotGameFooter) {
      slotGameFooter.style.display = 'flex';
    }

    setupBetControls();
    refreshSlotGameInfo();

    // New symbol order each time you open/refresh the slot page (like the original game)
    var sessionSymbols = shuffle([].concat(SYMBOLS_CLASSIC));

    // Initialize slot machine - elements must exist in HTML
    setTimeout(() => {
      try {
        slotMachine = new SlotMachine(
          slotGameArea,
          handleUseCoin,
          handleGetPrice,
          5, // 5 reels
          sessionSymbols,
          false, // not paused
          -1.8 // speed (degrees/ms; negative = spin direction)
        );
      } catch(e) {
        console.error('[initializeSlotGame] ERROR creating SlotMachine:', e);
        return;
      }
      
      setTimeout(() => {
        if (slotMachine && slotMachine.resize) {
          slotMachine.resize();
          setTimeout(() => slotMachine.resize(), 100);
          setTimeout(() => slotMachine.resize(), 300);
        }
      }, 100);

      // Pay table uses same session symbols (emoji → % for ×3, ×4, ×5)
      payTable = new PayTable(sessionSymbols);

      // Initialize modals (instructions + pay table)
      var instructionsRoot = document.getElementById('instructionsModal');
      var payTableRoot = document.getElementById('payTableModal');
      if (instructionsRoot) {
        instructionsModal = new Modal(
          '#instructionsModal',
          '#toggleInstructions',
          'instructions',
          false,
          false,
          handleModalToggle
        );
      }
      if (payTableRoot) {
        payTableModal = new Modal(
          '#payTableModal',
          '#togglePayTable',
          'pay-table',
          false,
          false,
          handleModalToggle
        );
      }

      // Fallback: open modals when footer buttons are clicked (handles icon click)
      var footer = document.getElementById('slotGameFooter');
      if (footer) {
        footer.addEventListener('click', function(e) {
          var openBtn = e.target.closest('#togglePayTable');
          if (openBtn && payTableModal && payTableModal.root) {
            e.preventDefault();
            e.stopPropagation();
            if (!payTableModal.isOpen) payTableModal.open('click');
            return;
          }
          openBtn = e.target.closest('#toggleInstructions');
          if (openBtn && instructionsModal && instructionsModal.root) {
            e.preventDefault();
            e.stopPropagation();
            if (!instructionsModal.isOpen) instructionsModal.open('click');
            return;
          }
        });
      }

      // Initialize volume slider (default 50%, user can adjust 0-100%)
      setupVolumeSlider();

      // Setup spin button (await handleUseCoin so server deducts bet before spin)
      const spinBtn = document.getElementById('slotSpinBtn');
      if (spinBtn) {
        spinBtn.onclick = async () => {
          if (isSpinning && slotMachine && slotMachine.currentReel !== null) {
            if (slotMachine.currentReel < slotMachine.reels.length) {
              slotMachine.handleClick();
            }
            return;
          }
          if (isSpinning) return;
          if (!window.Auth || !window.Auth.requireAuth(() => {})) return;

          if (currentBet <= 0) {
            alert('Please choose a bet above $0');
            return;
          }
          if (window.SlotIntegration) {
            window.SlotIntegration.setCurrentBet(currentBet);
          }
          if (!Game.canBet(currentBet)) {
            alert('Insufficient balance');
            return;
          }

          isSpinning = true;
          spinBtn.disabled = false;
          spinBtn.textContent = 'Stop';

          try {
            await handleUseCoin();
            if (slotMachine) slotMachine.start();
          } catch (e) {
            isSpinning = false;
            spinBtn.disabled = false;
            spinBtn.textContent = 'Spin';
          }
        };
      }
    }, 100);
  }

  // Export API
  console.log('[slot-integration.js] Creating window.SlotIntegration API...');
  window.SlotIntegration = {
    initialize: initializeSlotGame,
    getSlotMachine: () => slotMachine,
    getCurrentBet: () => {
      const betInput = document.getElementById('slotBet');
      if (betInput) {
        const v = parseFloat(betInput.value);
        if (!isNaN(v)) currentBet = clampBet(v);
      }
      return currentBet;
    },
    setCurrentBet: (bet) => {
      setCurrentBetValue(bet);
    },
    setIsSpinning: (spinning) => { isSpinning = spinning; },
    refreshSlotGameInfo
  };
  console.log('[slot-integration.js] window.SlotIntegration created:', {
    hasInitialize: typeof window.SlotIntegration.initialize === 'function',
    initialize: window.SlotIntegration.initialize
  });

  console.log('[slot-integration.js] Script execution complete. Ready for initialization.');

})();
