// Web Audio API Ambient Sound Synthesizer (Procedural - Zero Assets)

class AmbientSoundEngine {
  constructor() {
    this.audioCtx = null;
    this.currentTrack = 'none';
    this.isPlaying = false;
    this.masterGainNode = null;
    this.activeNodes = [];
    this.volume = 0.5;
  }

  init() {
    if (!this.audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioContext();
      this.masterGainNode = this.audioCtx.createGain();
      this.masterGainNode.gain.setValueAtTime(this.volume, this.audioCtx.currentTime);
      this.masterGainNode.connect(this.audioCtx.destination);
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  setVolume(val) {
    this.volume = Math.max(0, Math.min(1, val));
    if (this.masterGainNode && this.audioCtx) {
      this.masterGainNode.gain.setTargetAtTime(this.volume, this.audioCtx.currentTime, 0.05);
    }
  }

  stop() {
    if (this.masterGainNode && this.audioCtx) {
      this.masterGainNode.gain.setTargetAtTime(0, this.audioCtx.currentTime, 0.1);
    }
    setTimeout(() => {
      this.activeNodes.forEach(node => {
        try {
          if (node.stop) node.stop();
          if (node.disconnect) node.disconnect();
        } catch (e) {}
      });
      this.activeNodes = [];
      this.isPlaying = false;
      this.currentTrack = 'none';
    }, 150);
  }

  play(type) {
    this.init();
    if (this.currentTrack === type && this.isPlaying) {
      this.stop();
      return false;
    }

    this.stop();

    setTimeout(() => {
      this.masterGainNode.gain.setTargetAtTime(this.volume, this.audioCtx.currentTime, 0.1);
      if (type === 'rain') {
        this.createRainSound();
      } else if (type === 'brown') {
        this.createBrownNoiseSound();
      } else if (type === 'forest') {
        this.createForestSound();
      }
      this.currentTrack = type;
      this.isPlaying = true;
    }, 180);

    return true;
  }

  // Generates 5 seconds of procedural Pink Noise
  createPinkNoiseBuffer() {
    const bufferSize = this.audioCtx.sampleRate * 4;
    const buffer = this.audioCtx.createBuffer(1, bufferSize, this.audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;

    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }
    return buffer;
  }

  // Generates 4 seconds of Brown Noise (Deep focus rumble)
  createBrownNoiseBuffer() {
    const bufferSize = this.audioCtx.sampleRate * 4;
    const buffer = this.audioCtx.createBuffer(1, bufferSize, this.audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    let lastOut = 0.0;

    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      data[i] = (lastOut + (0.02 * white)) / 1.02;
      lastOut = data[i];
      data[i] *= 3.5; // Gain compensation
    }
    return buffer;
  }

  // Rain: Filtered pink noise + resonant high pass filter
  createRainSound() {
    const noiseBuffer = this.createPinkNoiseBuffer();
    const noiseSource = this.audioCtx.createBufferSource();
    noiseSource.buffer = noiseBuffer;
    noiseSource.loop = true;

    const lowpass = this.audioCtx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.setValueAtTime(1200, this.audioCtx.currentTime);

    const highpass = this.audioCtx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.setValueAtTime(320, this.audioCtx.currentTime);

    noiseSource.connect(lowpass);
    lowpass.connect(highpass);
    highpass.connect(this.masterGainNode);

    noiseSource.start();
    this.activeNodes.push(noiseSource, lowpass, highpass);
  }

  // Brown noise (Deep focus / coffee shop background hum)
  createBrownNoiseSound() {
    const noiseBuffer = this.createBrownNoiseBuffer();
    const noiseSource = this.audioCtx.createBufferSource();
    noiseSource.buffer = noiseBuffer;
    noiseSource.loop = true;

    const lowpass = this.audioCtx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.setValueAtTime(450, this.audioCtx.currentTime);

    noiseSource.connect(lowpass);
    lowpass.connect(this.masterGainNode);

    noiseSource.start();
    this.activeNodes.push(noiseSource, lowpass);
  }

  // Forest / Breeze: Modulated filtered noise
  createForestSound() {
    const noiseBuffer = this.createPinkNoiseBuffer();
    const noiseSource = this.audioCtx.createBufferSource();
    noiseSource.buffer = noiseBuffer;
    noiseSource.loop = true;

    const filter = this.audioCtx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(800, this.audioCtx.currentTime);
    filter.Q.setValueAtTime(1.8, this.audioCtx.currentTime);

    // LFO to simulate gentle wind swell
    const lfo = this.audioCtx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(0.18, this.audioCtx.currentTime); // Gentle 5.5s cycle

    const lfoGain = this.audioCtx.createGain();
    lfoGain.gain.setValueAtTime(350, this.audioCtx.currentTime);

    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);

    noiseSource.connect(filter);
    filter.connect(this.masterGainNode);

    lfo.start();
    noiseSource.start();
    this.activeNodes.push(noiseSource, filter, lfo, lfoGain);
  }
}

window.ambientSound = new AmbientSoundEngine();
