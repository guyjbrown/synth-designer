import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs';
import {loadWaveTables} from './tables/wavetables';

// TODO add crossfade node
// TODO the noise node is really inefficient - generates 2 seconds of noise for every note
// TODO audio node is no longer used, remove it
// TODO add a formant filter
// check

window.addEventListener('DOMContentLoaded', init);

const MIDI_CONTROLLERS = [74, 71, 76, 77, 93, 18, 19, 16];
let controlMap;

// wavetables

let WAVE_TABLES;

// various constants

const MIDDLE_C = 261.63; // Hz
const MAX_MIDI_NOTE = 127; // G9
const MIN_MIDI_NOTE = 21;  // A0
const MAX_LEVEL = 1;
const MIN_LEVEL = 0;

// flags

const SHOW_DOC_STRINGS = false;
const VERBOSE = true;

// midi stuff

const MIDI_NOTE_ON = 0x90;
const MIDI_NOTE_OFF = 0x80;

// file handle

let fileHandle;

// midi context

let midi = null;
let midiInputs = null;
let midiInputEnabled = false;

// this is a map from midi note -> player

let playerForNote = new Map();

// effects

let reverb;

// monitor - keep track of how many notes and nodes we have

let monitor;

// scope

let scope;

// gui stuff

const midiDot = gui("dot"); // we need this quickly so cache it
const DOT_DURATION_MS = 50; // pulse the dot for 50ms when we get a midi note on

// global variables (sorry)

let synthGrammar;
let semantics;
let wasEdited;
let currentJSON = null;
let generator = null;
let context = null;
let moduleContext = {};

// ------------------------------------------------------------
// Prototype oscillator class
// ------------------------------------------------------------

class Oscillator {

  osc
  context

  constructor(ctx) {
    this.context = ctx;
    this.osc = ctx.createOscillator(ctx);
    this.osc.frequency.value = MIDDLE_C;
    monitor.retain("osc");
  }

  set detune(n) {
    this.osc.detune.value = n;
  }

  get detune() {
    return this.osc.detune.value;
  }

  get pitch() {
    return this.osc.frequency.value;
  }

  set pitch(n) {
    this.osc.frequency.value = n;
  }

  get out() {
    return this.osc;
  }

  get pitchCV() {
    return this.osc.frequency;
  }

  start(tim) {
    if (VERBOSE) console.log("starting oscillator");
    this.osc.start(tim);
  }

  stop(tim) {
    if (VERBOSE) console.log("stopping Oscillator");
    this.osc.stop(tim);
    let stopTime = tim - this.context.currentTime;
    if (stopTime < 0) stopTime = 0;
    setTimeout(() => {
      if (VERBOSE) console.log("disconnecting Oscillator");
      this.osc.disconnect();
      this.osc = null;
      this.context = null;
      monitor.release("osc");
    }, (stopTime + 0.1) * 1000);
  }

}

// ------------------------------------------------------------
// LFO with adjustable phase
// ------------------------------------------------------------

moduleContext.LFO = class {

  #sinOsc
  #cosOsc
  #sinGain
  #cosGain
  #mixer
  #freqHz
  #context

  constructor(ctx) {
    this.#context = ctx;
    this.#freqHz = 5; // Hz

    this.#sinOsc = ctx.createOscillator();
    this.#sinOsc.type = "sine";
    this.#sinOsc.frequency.value = this.#freqHz;

    this.#cosOsc = ctx.createOscillator();
    this.#cosOsc.type = "sine";
    this.#cosOsc.frequency.value = this.#freqHz;

    this.#sinGain = ctx.createGain();
    this.#cosGain = ctx.createGain();
    this.#mixer = ctx.createGain();

    this.#sinOsc.connect(this.#sinGain);
    this.#cosOsc.connect(this.#cosGain);
    this.#sinGain.connect(this.#mixer);
    this.#cosGain.connect(this.#mixer);

    monitor.retain("lfo");

  }

  set phase(p) {
    this.#sinGain.gain.value = Math.cos(p);
    this.#cosGain.gain.value = Math.sin(p);
  }

  get pitch() {
    return this.#freqHz;
  }

  set pitch(n) {
    this.#freqHz = n;
    this.#sinOsc.frequency.value = this.#freqHz;
    this.#cosOsc.frequency.value = this.#freqHz;
  }

  get out() {
    return this.#mixer;
  }

  start(tim) {
    this.#sinOsc.start(tim);
    this.#cosOsc.start(tim);
  }

  stop(tim) {
    if (VERBOSE) console.log("stopping LFO");
    this.#sinOsc.stop(tim);
    this.#cosOsc.stop(tim);
    let stopTime = tim - this.#context.currentTime;
    if (stopTime < 0) stopTime = 0;
    setTimeout(() => {
      if (VERBOSE) console.log("disconnecting LFO");
      this.#sinOsc.disconnect();
      this.#cosOsc.disconnect();
      this.#sinGain.disconnect();
      this.#cosGain.disconnect();
      this.#mixer.disconnect();
      this.#sinOsc = null;
      this.#cosOsc = null;
      this.#sinGain = null;
      this.#cosGain = null;
      this.#mixer = null;
      this.#context = null;
      monitor.release("lfo");
    }, (stopTime + 0.1) * 1000);
  }

}

// ------------------------------------------------------------
// Stereo panner
// ------------------------------------------------------------

moduleContext.Panner = class {

  #pan
  #context

  constructor(ctx) {
    this.#context = ctx;
    this.#pan = ctx.createStereoPanner();
    monitor.retain("panner");
  }

  // stereo position between -1 and 1
  set angle(p) {
    this.#pan.pan.value = p;
  }

  // stereo position between -1 and 1
  get angle() {
    return this.#pan.pan.value;
  }

  get angleCV() {
    return this.#pan.pan;
  }

  get in() {
    return this.#pan;
  }

  get out() {
    return this.#pan;
  }

  stop(tim) {
    if (VERBOSE) console.log("stopping Panner");
    let stopTime = tim - this.#context.currentTime;
    if (stopTime < 0) stopTime = 0;
    setTimeout(() => {
      if (VERBOSE) console.log("disconnecting Panner");
      this.#pan.disconnect();
      this.#pan = null;
      this.#context = null;
      monitor.release("panner");
    }, (stopTime + 0.1) * 1000);
  }

}

// ------------------------------------------------------------
// Delay line
// ------------------------------------------------------------

moduleContext.Delay = class {

  #delay
  #context

  constructor(ctx) {
    this.#context = ctx;
    this.#delay = ctx.createDelay(10);
    monitor.retain("delay");
  }

  set lag(t) {
    this.#delay.delayTime.value = t;
  }

  get lag() {
    return this.#delay.delayTime.value;
  }

  get lagCV() {
    return this.#delay.delayTime;
  }

  get in() {
    return this.#delay;
  }

  get out() {
    return this.#delay;
  }

  stop(tim) {
    if (VERBOSE) console.log("stopping Delay");
    let stopTime = tim - this.#context.currentTime;
    if (stopTime < 0) stopTime = 0;
    setTimeout(() => {
      if (VERBOSE) console.log("disconnecting Delay");
      this.#delay.disconnect();
      this.#delay = null;
      this.#context = null;
      monitor.release("delay");
    }, (stopTime + 0.1) * 1000);
  }

}

// ----------------------------------------------------
// WAVETABLE auxilliary functions
// ----------------------------------------------------

function getWaveTable(ctx,name,index) {
  const table = WAVE_TABLES[name];
  console.log(table);
  return ctx.createPeriodicWave(table[index].real, table[index].imag);
}

function makeInterpolator(num_tables, k) {
  const curve = new Float32Array(num_tables).fill(0);
  curve[k] = 1;
  return curve;
}

// ----------------------------------------------------
// WAVETABLE OSCILLATOR
// OK so this is quite tricky to do without using a worker node, which had all sorts of memory issues
// This code only uses the WebAudio API and does a reasonable job, but is limited to a relatvely small
// number of waves in each table.
// The approach is to run 8 custom oscillators in parallel and blend between them. Each oscillator has a custom waveform.
// This sounds inefficient but since each oscillator is a pretty lightweight process (table lookup) it's not too bad
// Each oscillator outputs to a gain that controls its level
//
// How to control the gains at audio rate?
// This can be done by associating each oscillator with a waveShaperNode
// The shaper functions for each oscillator are
// 1 0 0 0 0 0 0 0
// 0 1 0 0 0 0 0 0
// 0 0 1 0 0 0 0 0
// ...
// and so on. A wave shaper is basically a lookup table with linear interpolation, so given a wave table index
// between -1 and 1 it will output a gain that is 1 at the oscillator index and then linearly falls off to zero
// as the index increases or decreases.
// The final component is a constant source node that outputs a constant 1. That goes into each oscillator gain,
// gets modulated by the mixing coefficient from each wave shaper, leading to a set of gains that smoothly
// blend the different oscillators as you sweep through the index. This can be done at audio rate (so for example
// you could use a LFO or envelope to sweep through the tables)
// ----------------------------------------------------

moduleContext.WaveTableOsc = class {

  _num_tables = 8
  _osc
  _gain
  _out
  _context
  _index = 0
  _pitchcontrol
  _detunecontrol
  _indexcontrol
  _interpolator
  _unity

  constructor(ctx) {
    this._context = ctx;
    this._osc = [];
    this._gain = [];
    this._interpolator=[];
    this._out = new GainNode(ctx, {
      gain: 1
    });
    // output a constant 1, which gets modulated by the interpolators
    this._unity = new ConstantSourceNode(ctx,{
      offset : 1
    });
    // pitch control attached to all oscillators
    this._pitchcontrol = new ConstantSourceNode(ctx, {
      offset : 0
    });
    // detune control attached to all oscillators
    this._detunecontrol = new ConstantSourceNode(ctx, {
      offset : 0
    });
    // a single control that is attached to all the interpolators
    this._indexcontrol = new ConstantSourceNode(ctx, {
      offset : 0
    });
    // we have a number of oscillators in parallel
    for (let i=0; i<this._num_tables; i++) {
      // oscillator
      this._osc[i] = ctx.createOscillator();
      this._osc[i].frequency.value = 0; // the constant source node controls frequency
      this._osc[i].setPeriodicWave(getWaveTable(ctx,"COMB_SAW",i));
      // gain
      this._gain[i] = new GainNode(ctx, {
        gain: 0 // all gains are set by an interpolator
      });
      // interpolators
      this._interpolator[i] = ctx.createWaveShaper();
      this._interpolator[i].curve = makeInterpolator(this._num_tables,i);
      this._interpolator[i].oversample = "none";
      // connect it all up
      // pitch and detune
      this._pitchcontrol.connect(this._osc[i].frequency);
      this._detunecontrol.connect(this._osc[i].detune);
      // oscillators into gains
      this._osc[i].connect(this._gain[i]);
      // gains mixed at the output
      this._gain[i].connect(this._out);
      // index control sets the waveshaper input for each interpolator
      this._indexcontrol.connect(this._interpolator[i]);
      // interpolators output a value for the gain control
      this._interpolator[i].connect(this._gain[i].gain);
      // each gain gets a unity input so it outputs between 0-1 at audio rate
      this._unity.connect(this._gain[i]);
    }
    monitor.retain("osc");
  }

  set detune(n) {
      this._detunecontrol.offset.value = n;
  }

  // set the pitch
  set pitch(f) {
      this._pitchcontrol.offset.value = f;
  }

  // k should be between -1 and 1
  // we don't check it here since it would be repeating work, since the
  // waveShaperNode will clip input values in any case and we can never
  // get a gain out of the interpolator outside the range [0,1]
  set index(k) {
    this._indexcontrol.offset.value = k;
  }

  get indexCV() {
    return this._indexcontrol.offset;
  }

  // get the output node
  get out() {
    return this._out;
  }

  // the pitch CV is the constant source node offset connected to both oscillator frequencies
  get pitchCV() {
    return this._osc.pitchcontrol;
  }

  // start everything, including the source nodes
  start(tim) {
    for (let i = 0; i < this._num_tables; i++) {
      this._osc[i].start(tim);
    }
    this._pitchcontrol.start(tim);
    this._detunecontrol.start(tim);
    this._unity.start(tim);
    this._indexcontrol.start(tim);
  }

  // stop everything
  stop(tim) {
    if (VERBOSE) console.log("stopping WaveTableOsc");
    for (let i = 0; i < this._num_tables; i++) {
      this._osc[i].stop(tim);
    }
    let stopTime = tim - this._context.currentTime;
    if (stopTime < 0) stopTime = 0;
    setTimeout(() => {
      if (VERBOSE) console.log("disconnecting WaveTableOsc");
      for (let i = 0; i < this._num_tables; i++) {
        this._gain[i].disconnect();
        this._gain[i] = null;
        this._osc[i].disconnect();
        this._osc[i] = null;
      }
      this._out.disconnect();
      this._out = null;
      this._pitchcontrol.disconnect();
      this._pitchcontrol=null;
      this._detunecontrol.disconnect();
      this._detunecontrol=null;
      this._indexcontrol.disconnect();
      this._indexcontrol=null;
      this._unity.disconnect();
      this._unity=null;
      this._context = null;
      monitor.release("osc");
    }, (stopTime + 0.1) * 1000);
  }

}

// ------------------------------------------------------------
// Pulse oscillator function
// this is quite a bit more complex than the standard oscillator
// to make a pulse we need to compute the difference of two saws
// https://speakerdeck.com/stevengoldberg/pulse-waves-in-webaudio?slide=13
// ------------------------------------------------------------

moduleContext.PulseOsc = class extends Oscillator {

  osc2
  detuneNode
  freqNode
  #out
  inverter
  delay
  freqHz
  #pulsewidth
  pwm

  constructor(ctx) {
    super(ctx);

    // set the parameters of oscillator 1
    // we set the oscillator value to 0 to avoid an offset since we will control the
    // frequency of the two oscillatoes via the ConstantSourceNode
    this.freqHz = MIDDLE_C;
    this.osc.frequency.value = 0;
    this.osc.type = "sawtooth"

    // set the parameters of oscillator 2
    this.osc2 = ctx.createOscillator();
    this.osc2.frequency.value = 0;
    this.osc2.type = "sawtooth"

    // set the initial pulsewidth to 50%
    this.#pulsewidth = 0.5;

    // the inverter, which subtracts one saw from the other
    this.inverter = ctx.createGain(ctx);
    this.inverter.gain.value = -1;

    // constant source node to change frequency and detune of both oscillators
    this.freqNode = new ConstantSourceNode(ctx);
    this.detuneNode = new ConstantSourceNode(ctx);

    // connect them up
    this.freqNode.connect(this.osc.frequency);
    this.freqNode.connect(this.osc2.frequency);
    this.detuneNode.connect(this.osc.detune);
    this.detuneNode.connect(this.osc2.detune);

    // sum the outputs into this gain
    this.#out = ctx.createGain();
    this.#out.gain.value = 0.5;

    // the delay is a fraction of the period, given by the pulse width
    this.delay = ctx.createDelay();
    this.delay.delayTime.value = this.#pulsewidth / this.freqHz;

    // pulse width modulation
    this.pwm = ctx.createGain();
    this.pwm.gain.value = 1 / this.freqHz;
    this.pwm.connect(this.delay.delayTime);

    // connect everything else
    this.osc.connect(this.delay);
    this.delay.connect(this.inverter);
    this.inverter.connect(this.#out);
    this.osc2.connect(this.#out);

  }

  // set the pulse width which should be in the range [0,1]
  // a width of 0.5 corresponds to a square wave
  // we keep track of the frequency in a variable since we need to set the frequency
  // of the oscillator to zero and set frequency through the constantsource node
  // it would cause division by zero issues if used directly
  set pulsewidth(w) {
    this.#pulsewidth = w;
    this.delay.delayTime.value = w / this.freqHz;
  }

  // get the pulse width value
  get pulsewidth() {
    return this.#pulsewidth;
  }

  // set the detune of both oscillators through the constant source node
  set detune(n) {
    this.detuneNode.offset.value = n;
  }

  // set the pitch
  // when the pitch changes, we need to update the maximum delay time which is 1/f
  // and the current delay which is pulsewidth/f
  set pitch(f) {
    this.freqHz = f;
    this.pwm.gain.value = 1 / this.freqHz;
    this.delay.delayTime.value = this.#pulsewidth / f;
    this.freqNode.offset.value = f;
  }

  // get the output node
  get out() {
    return this.#out;
  }

  // the pulsewidth CV for PWM which takes an input through a gain node and scales it to
  // the maximum of the period
  // this means that we can set pulsewidth to 0.5 and then CV should be in the range [0,0.5]
  get pulsewidthCV() {
    return this.pwm;
  }

  // the pitch CV is the constant source node offset connected to both oscillator frequencies
  get pitchCV() {
    return this.freqNode.offset;
  }

  // start everything, including the source nodes
  start(tim) {
    this.freqNode.start(tim);
    this.detuneNode.start(tim);
    this.osc.start(tim);
    this.osc2.start(tim);
  }

  // stop everything
  stop(tim) {
    if (VERBOSE) console.log("stopping Pulse");
    this.osc.stop(tim);
    this.osc2.stop(tim);
    this.freqNode.stop(tim);
    this.detuneNode.stop(tim);
    let stopTime = tim - this.context.currentTime;
    if (stopTime < 0) stopTime = 0;
    setTimeout(() => {
      if (VERBOSE) console.log("disconnecting Pulse");
      this.osc.disconnect();
      this.osc2.disconnect();
      this.freqNode.disconnect();
      this.detuneNode.disconnect();
      this.#out.disconnect();
      this.delay.disconnect();
      this.inverter.disconnect();
      this.pwm.disconnect();
      this.osc = null;
      this.osc2 = null;
      this.freqNode = null;
      this.detuneNode = null;
      this.#out = null;
      this.delay = null;
      this.inverter = null;
      this.pwm = null;
      this.context = null;
      monitor.release("osc");
    }, (stopTime + 0.1) * 1000);
  }

}

// ------------------------------------------------------------
// Saw oscillator class
// ------------------------------------------------------------

moduleContext.SawOsc = class extends Oscillator {
  constructor(ctx) {
    super(ctx);
    this.osc.type = "sawtooth";
  }
}

// ------------------------------------------------------------
// Sin oscillator class
// ------------------------------------------------------------

moduleContext.SinOsc = class extends Oscillator {
  constructor(ctx) {
    super(ctx);
    this.osc.type = "sine";
  }
}

// ------------------------------------------------------------
// Triangle oscillator class
// ------------------------------------------------------------

moduleContext.TriOsc = class extends Oscillator {
  constructor(ctx) {
    super(ctx);
    this.osc.type = "triangle";
  }
}

// ------------------------------------------------------------
// Square oscillator class
// ------------------------------------------------------------

moduleContext.SquareOsc = class extends Oscillator {
  constructor(ctx) {
    super(ctx);
    this.osc.type = "square";
  }
}

// ------------------------------------------------------------
// Noise generator class
// for reasons of efficiency we loop a 2-second buffer of noise rather than generating
// random numbers for every sample
// https://noisehack.com/generate-noise-web-audio-api/
// TODO actually this is still very inefficient - we should share a noise generator across
// all players
// ------------------------------------------------------------

moduleContext.Noise = class NoiseGenerator {

  #noise
  #context

  constructor(ctx) {
    this.#context = ctx;
    let bufferSize = 2 * ctx.sampleRate;
    let noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    let data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++)
      data[i] = Math.random() * 2 - 1;
    this.#noise = ctx.createBufferSource();
    this.#noise.buffer = noiseBuffer;
    this.#noise.loop = true;
    monitor.retain("noise");
  }

  get out() {
    return this.#noise;
  }

  start(tim) {
    this.#noise.start(tim);
  }

  stop(tim) {
    if (VERBOSE) console.log("stopping Noise");
    this.#noise.stop(tim);
    let stopTime = tim - this.#context.currentTime;
    if (stopTime < 0) stopTime = 0;
    setTimeout(() => {
      if (VERBOSE) console.log("disconnecting Noise");
      this.#noise.disconnect();
      this.#noise = null;
      this.#context = null;
      monitor.release("noise");
    }, (stopTime + 0.1) * 1000);
  }

}

// ------------------------------------------------------------
// LPF class
// ------------------------------------------------------------

moduleContext.LowpassFilter = class {

  #filter
  #context

  constructor(ctx) {
    this.#context = ctx;
    this.#filter = ctx.createBiquadFilter();
    this.#filter.frequency.value = 1000;
    this.#filter.Q.value = 1;
    this.#filter.type = "lowpass";
    monitor.retain("lowpass");
  }

  get cutoff() {
    return this.#filter.frequency.value;
  }

  set cutoff(f) {
    this.#filter.frequency.value = f;
  }

  get cutoffCV() {
    return this.#filter.frequency;
  }

  get resonance() {
    return this.#filter.Q.value;
  }

  set resonance(r) {
    this.#filter.Q.value = r;
  }

  get in() {
    return this.#filter;
  }

  get out() {
    return this.#filter;
  }

  stop(tim) {
    if (VERBOSE) console.log("stopping LPF");
    let stopTime = tim - this.#context.currentTime;
    if (stopTime < 0) stopTime = 0;
    setTimeout(() => {
      if (VERBOSE) console.log("disconnecting LPF");
      this.#filter.disconnect();
      this.#filter = null;
      this.#context = null;
      monitor.release("lowpass");
    }, (stopTime + 0.1) * 1000);
  }

}

// ------------------------------------------------------------
// HPF class
// ------------------------------------------------------------

moduleContext.HighpassFilter = class {

  #filter
  #context

  constructor(ctx) {
    this.#context = ctx;
    this.#filter = ctx.createBiquadFilter();
    this.#filter.frequency.value = 1000;
    this.#filter.Q.value = 1;
    this.#filter.type = "highpass";
    monitor.retain("highpass");
  }

  get cutoff() {
    return this.#filter.frequency.value;
  }

  set cutoff(f) {
    this.#filter.frequency.value = f;
  }

  get cutoffCV() {
    return this.#filter.frequency;
  }

  get resonance() {
    return this.#filter.Q.value;
  }

  set resonance(r) {
    this.#filter.Q.value = r;
  }

  get in() {
    return this.#filter;
  }

  get out() {
    return this.#filter;
  }

  stop(tim) {
    if (VERBOSE) console.log("stopping HPF");
    let stopTime = tim - this.#context.currentTime;
    if (stopTime < 0) stopTime = 0;
    setTimeout(() => {
      if (VERBOSE) console.log("disconnecting HPF");
      this.#filter.disconnect();
      this.#filter = null;
      this.#context = null;
      monitor.release("highpass");
    }, (stopTime + 0.1) * 1000);
  }

}

// ------------------------------------------------------------
// ADSR class
// ------------------------------------------------------------

moduleContext.Envelope = class {

  #attack
  #decay
  #sustain
  #release
  #level
  #controlledParam
  #context

  constructor(ctx) {
    this.#context = ctx;
    this.#attack = 0.1;
    this.#decay = 0.5;
    this.#sustain = 0.5;
    this.#release = 0.1;
    this.#level = 1.0;
  }

  set attack(v) {
    this.#attack = v;
  }

  set decay(v) {
    this.#decay = v;
  }

  set sustain(v) {
    this.#sustain = v;
  }

  get release() {
    return this.#release;
  }

  set release(v) {
    this.#release = v;
  }

  set level(v) {
    this.#level = v;
    // this next bit only takes effect when the audio network is connected and playing
    if (this.#controlledParam != undefined)
      this.#controlledParam.setValueAtTime(v, this.#context.currentTime);
  }

  releaseOnNoteOff(when) {
    let value = this.#controlledParam.value;
    this.#controlledParam.cancelScheduledValues(when);
    this.#controlledParam.setValueAtTime(value, when);
    this.#controlledParam.linearRampToValueAtTime(0, when + this.#release);
  }

  apply(param, when) {
    this.#controlledParam = param;
    param.setValueAtTime(0, when);
    param.linearRampToValueAtTime(this.#level, when + this.#attack);
    param.linearRampToValueAtTime(this.#sustain, when + this.#attack + this.#decay);
  }

}

// ------------------------------------------------------------
// Decay class - linear attack and exponential decay envelope
// ------------------------------------------------------------

moduleContext.Decay = class {

  #attack
  #decay
  #level
  #param

  constructor(ctx) {
    this.#attack = 0.1;
    this.#decay = 0.5;
    this.#level = 1.0;
  }

  set attack(v) {
    this.#attack = v;
  }

  set decay(v) {
    this.#decay = v;
  }

  set level(v) {
    this.#level = v;
  }

  apply(param, when) {
    this.#param = param;
    param.setValueAtTime(0, when);
    param.linearRampToValueAtTime(this.#level, when + this.#attack);
    param.exponentialRampToValueAtTime(0.01, when + this.#attack + this.#decay);
  }

  releaseOnNoteOff() {
    // dummy function - messy
  }

  get release() {
    const currentLevel = this.#param.value;
    if (currentLevel > 0) {
      const k = -Math.log(0.01 / this.#level) / this.#decay;
      return -Math.log(0.01 / currentLevel) / k;
    } else {
      return 0.01;
    }
  }

}

// ------------------------------------------------------------
// Waveshaper class
// ------------------------------------------------------------

moduleContext.Waveshaper = class {

  #shaper
  #context

  constructor(ctx) {
    this.#context = ctx;
    this.#shaper = ctx.createWaveShaper();
    this.#shaper.curve = this.makeDistortionCurve(100);
    this.#shaper.oversample = "4x";
    monitor.retain("shaper");
  }

  get in() {
    return this.#shaper;
  }

  get out() {
    return this.#shaper;
  }

  get fuzz() {
    return 0; // all that matters is that this returns a number
  }

  set fuzz(n) {
    this.#shaper.curve = this.makeDistortionCurve(n);
  }

  // this is a sigmoid function which is linear for k=0 and goes through (-1,-1), (0,0) and (1,1)
  // https://stackoverflow.com/questions/22312841/waveshaper-node-in-webaudio-how-to-emulate-distortion

  makeDistortionCurve(n) {
    const numSamples = 44100;
    const curve = new Float32Array(numSamples);
    //const deg = Math.PI / 180.0;
    for (let i = 0; i < numSamples; i++) {
      const x = (i * 2) / numSamples - 1;
      curve[i] = (Math.PI + n) * x / (Math.PI + n * Math.abs(x));
    }
    return curve;
  }

  stop(tim) {
    if (VERBOSE) console.log("stopping Shaper");
    let stopTime = tim - this.#context.currentTime;
    if (stopTime < 0) stopTime = 0;
    setTimeout(() => {
      if (VERBOSE) console.log("disconnecting Shaper");
      this.#shaper.disconnect();
      this.#shaper = null;
      this.#context = null;
      monitor.release("shaper");
    }, (stopTime + 0.1) * 1000);
  }

}

// ------------------------------------------------------------
// Amplifier class
// ------------------------------------------------------------

moduleContext.Amplifier = class {

  #gain
  #context

  constructor(ctx) {
    this.#context = ctx;
    this.#gain = unityGain(ctx);
    monitor.retain("amp");
  }

  get in() {
    return this.#gain;
  }

  get out() {
    return this.#gain;
  }

  get level() {
    return this.#gain.gain.value;
  }

  set level(n) {
    this.#gain.gain.value = n;
  }

  get levelCV() {
    return this.#gain.gain;
  }

  stop(tim) {
    if (VERBOSE) console.log("stopping Amplifier");
    let stopTime = tim - this.#context.currentTime;
    if (stopTime < 0) stopTime = 0;
    setTimeout(() => {
      if (VERBOSE) console.log("disconnecting Amplifier");
      this.#gain.disconnect();
      this.#gain = null;
      this.#context = null;
      monitor.release("amp");
    }, (stopTime + 0.1) * 1000);
  }

}

// mapping between grammar names for modules and class names

const moduleClasses = {
  "SAW-OSC": "SawOsc",
  "SIN-OSC": "SinOsc",
  "TRI-OSC": "TriOsc",
  "SQR-OSC": "SquareOsc",
  "PULSE-OSC": "PulseOsc",
  "WAVE-OSC" : "WaveTableOsc",
  "LFO": "LFO",
  "PAN": "Panner",
  "NOISE": "Noise",
  "LPF": "LowpassFilter",
  "HPF": "HighpassFilter",
  "VCA": "Amplifier",
  "SHAPER": "Waveshaper",
  "ADSR": "Envelope",
  "DECAY": "Decay",
  "AUDIO": "Audio",
  "DELAY": "Delay"
};

// valid tweaks, used for error checking

const validTweaks = {
  "SAW-OSC": ["detune", "pitch"],
  "SIN-OSC": ["detune", "pitch"],
  "SQR-OSC": ["detune", "pitch"],
  "TRI-OSC": ["detune", "pitch"],
  "WAVE-OSC": ["detune", "pitch", "index"],
  "PULSE-OSC": ["detune", "pitch", "pulsewidth"],
  "LFO": ["pitch", "phase"],
  "LPF": ["cutoff", "resonance"],
  "HPF": ["cutoff", "resonance"],
  "VCA": ["level"],
  "SHAPER": ["fuzz"],
  "ADSR": ["attack", "decay", "sustain", "release", "level"],
  "DECAY": ["attack", "decay", "level"],
  "PAN": ["angle"],
  "DELAY": ["lag"],
  "FOLDER": ["threshold", "symmetry", "gain", "level", "stages"]
};

// valid patch inputs, used for error checking

const validPatchInputs = {
  "AUDIO": ["in"],
  "SAW-OSC": ["pitchCV"],
  "SIN-OSC": ["pitchCV"],
  "SQR-OSC": ["pitchCV"],
  "TRI-OSC": ["pitchCV"],
  "WAVE-OSC": ["pitchCV","indexCV"],
  "PULSE-OSC": ["pitchCV", "pulsewidthCV"],
  "LPF": ["in", "cutoffCV"],
  "HPF": ["in", "cutoffCV"],
  "VCA": ["in", "levelCV"],
  "SHAPER": ["in"],
  "PAN": ["in", "angleCV"],
  "DELAY": ["in", "lagCV"],
  "FOLDER": ["in", "thresholdCV", "symmetryCV", "levelCV", "gainCV"]
};

// valid patch outputs - pointless at the moment but in future modules may have more than one output

const validPatchOutputs = {
  "SAW-OSC": ["out"],
  "SIN-OSC": ["out"],
  "SQR-OSC": ["out"],
  "TRI-OSC": ["out"],
  "WAVE-OSC": ["out"],
  "PULSE-OSC": ["out"],
  "LFO": ["out"],
  "NOISE": ["out"],
  "LPF": ["out"],
  "HPF": ["out"],
  "VCA": ["out"],
  "SHAPER": ["out"],
  "ADSR": ["out"],
  "DECAY": ["out"],
  "PAN": ["out"],
  "DELAY": ["out"],
  "FOLDER": ["out"]
};

// ------------------------------------------------------------
// monitor structure
// ------------------------------------------------------------

class Monitor {

  #numNotes
  #fields

  constructor() {
    this.#numNotes = 0;
    this.#fields = {
      note: 0,
      osc: 0,
      amp: 0,
      lowpass: 0,
      highpass: 0,
      lfo: 0,
      panner: 0,
      delay: 0,
      noise: 0,
      shaper: 0,
      audio: 0
    }
  }

  retain(f) {
    this.#fields[f]++;
    this.display();
  }

  release(f) {
    this.#fields[f]--;
    this.display();
  }

  display() {
    let str = "";
    for (const key in this.#fields) {
      str += `${key} ${this.#fields[key]} : `;
    }
    gui("monitor").textContent = str;
  }
}

// ------------------------------------------------------------
// initialise the button callbacks etc
// ------------------------------------------------------------

async function init() {
  mermaid.initialize({
    startOnLoad: true,
    theme: 'base',
    themeVariables: {
      "primaryColor": "#4f4f4f",
      "primaryTextColor": "#ccc",
      "primaryBorderColor": "#4f4f4f",
      "lineColor": "#aaaaaa",
      "secondaryColor": "#006100",
      "tertiaryColor": "#fff"
    }
  });

  disableGUI(true);
  addListenersToGUI();
  setupMidi();
  makeGrammar();
  WAVE_TABLES = await loadWaveTables();
  console.log(WAVE_TABLES);
  setDefaultValues();
  monitor = new Monitor();
}

// ------------------------------------------------------------
// set default parameters
// ------------------------------------------------------------

function setDefaultValues() {
  setFloatControl("level", 0.8);
  setFloatControl("reverb", 0.1);
}

// ------------------------------------------------------------
// dynamically add an HTML slider to the page
// ------------------------------------------------------------

function makeSlider(containerName, id, docstring, min, max, val, step) {
  // get the root container
  const container = document.getElementById(containerName);
  // make the slider container
  const sliderContainer = document.createElement("div");
  sliderContainer.className = "slider-container";
  sliderContainer.id = "param-" + id;
  // make the slider
  const slider = document.createElement("input");
  slider.className = "slider";
  slider.type = "range";
  slider.id = "slider-" + id;
  slider.min = min;
  slider.max = max;
  slider.step = step;
  slider.value = val;
  // doc string
  if (SHOW_DOC_STRINGS) {
    const doc = document.createElement("label");
    doc.className = "docstring";
    doc.id = "doc-" + id;
    doc.textContent = docstring;
    container.appendChild(doc);
  }
  // label
  const label = document.createElement("label");
  label.id = "label-" + id;
  label.setAttribute("for", "slider-" + id);
  label.textContent = `${id} [${val}]`;
  // add a callback to the slider
  slider.addEventListener("input", function () {
    let val = parseFloat(this.value);
    gui(label.id).textContent = `${id} [${val}]`;
    makeImmediateTweak(id, val);
  });
  // add to the document
  sliderContainer.appendChild(slider);
  sliderContainer.appendChild(label);
  container.appendChild(sliderContainer);
}

// ------------------------------------------------------------
// tweak a parameter in real time, changing it immediately
// ------------------------------------------------------------

function makeImmediateTweak(param, value) {
  playerForNote.forEach((player, note) => {
    player.applyTweakNow(param, value);
  });
}

// ------------------------------------------------------------
// remove all the sliders, if we created any previously
// ------------------------------------------------------------

function removeAllSliders() {
  for (let row = 1; row <= 2; row++) {
    const container = document.getElementById(`container${row}`);
    while (container.firstChild)
      container.removeChild(container.firstChild);
  }
}

// ------------------------------------------------------------
// add event listeners to GUI controls
// ------------------------------------------------------------

function addListenersToGUI() {

  // listen for change events in the text area and indicate if the file is edited

  gui("synth-spec").addEventListener("input", () => {
    if (gui("synth-spec").value.length > 0) {
      parseGeneratorSpec();
      if (!wasEdited) {
        gui("file-label").textContent += "*";
        wasEdited = true;
      }
    }
  });

  // set the current file name to none
  gui("file-label").textContent = "Current file: none";

  // load button
  gui("load-button").onclick = async () => { await loadFile(); };

  // save button
  gui("save-button").onclick = async () => { await saveFile(); };

  // save as button
  gui("save-as-button").onclick = async () => { await saveAsFile(); };

  // export button
  gui("export-button").onclick = async () => { await exportAsJSON(); };

  // copy parameters to clipboard button
  gui("clip-button").onclick = () => { copyParamsToClipboard(); };

  // copy docs to clipboard button
  gui("docs-button").onclick = () => { copyDocsToClipboard(); };

  // play button
  gui("play-button").onmousedown = () => {
    const midiNoteNumber = getIntParam("slider-pitch");
    const velocity = getFloatParam("slider-level");
    playNote(midiNoteNumber, velocity);
  };
  gui("play-button").onmouseup = () => {
    const midiNoteNumber = getIntParam("slider-pitch");
    stopNote(midiNoteNumber);
  };
  gui("play-button").onmouseout = () => {
    const midiNoteNumber = getIntParam("slider-pitch");
    stopNote(midiNoteNumber);
  };

  // start button
  gui("start-button").onclick = async () => {
    context = new AudioContext();
    disableGUI(false);
    connectEffects(context);
    initialiseEffects();
    let view = new ScopeView(gui("scope-canvas"), {
      lineWidth: 2,
      sync: true
    });
    scope = new Scope(context, view);
    scope.draw();
  }

  // pitch slider
  gui("slider-pitch").addEventListener("input", function () {
    gui("label-pitch").textContent = `pitch [${midiToNoteName(parseInt(this.value))}]`;
  });

  // amplitude slider
  gui("slider-level").addEventListener("input", function () {
    setFloatControl("level", parseFloat(this.value));
  });

  // reverb slider
  gui("slider-reverb").addEventListener("input", function () {
    setReverb(parseFloat(this.value));
  });

  // midi input selector
  gui("midi-input").addEventListener("change", () => {
    midiInputEnabled = false;
    const index = parseInt(gui("midi-input").value);
    if (midi != null && index > 0) {
      let selectedName = midiInputs[index - 1].name;
      // note that we need to set all callbacks since we might change the midi input while running
      // and then the previous callback would persist
      for (let val of midi.inputs.values()) {
        if (val.name === selectedName)
          val.onmidimessage = onMIDIMessage;
        else
          val.onmidimessage = undefined;
      }
      midiInputEnabled = true;
    }
  });

}

// ------------------------------------------------------------
// copy parameters to clipboard
// ------------------------------------------------------------

function copyParamsToClipboard() {
  if (generator != undefined && generator.isValid) {
    const params = getParametersForGenerator(generator);
    const text = getParameterListAsString(params);
    navigator.clipboard.writeText(text).then(() => {
      console.log(text);
    }, (error) => {
      console.error("Failed to copy text: ", error);
    });
  }
}

// ------------------------------------------------------------
// copy docs to clipboard
// ------------------------------------------------------------

function copyDocsToClipboard() {
  if (generator != undefined && generator.isValid) {
    const text = generator.getDocumentationAsMarkdownString();
    navigator.clipboard.writeText(text).then(() => {
      console.log(text);
    }, (error) => {
      console.error("Failed to copy text: ", error);
    });
  }
}

function getParameterListAsString(params) {
  let str = "use_defaults({";
  str += Object.entries(params).map(([key, value]) => `${key}=${value}`).join(',');
  str += "})";
  return str;
}

// ------------------------------------------------------------
// disable buttons
// ------------------------------------------------------------

function disableGUI(b) {
  gui("start-button").disabled = !b;
  gui("load-button").disabled = b;
  gui("save-button").disabled = b;
  gui("save-as-button").disabled = b;
  gui("export-button").disabled = b;
  gui("clip-button").disabled = b;
  gui("docs-button").disabled = b;
  gui("play-button").disabled = b;
  gui("midi-label").disabled = b;
  gui("midi-input").disabled = b;
}

// ------------------------------------------------------------
// Set up the MIDI system and find possible input devices
// ------------------------------------------------------------

function setupMidi() {

  navigator.requestMIDIAccess({ "sysex": "false" }).then((access) => {
    // Get lists of available MIDI controllers
    // might need to cache access
    midi = access;
    midiInputs = Array.from(access.inputs.values());

    // get the html element for the list of midi inputs
    const inputSelector = document.getElementById("midi-input");

    // first element in the list is no input
    let option = document.createElement("option");
    option.text = "None";
    option.value = 0;
    inputSelector.appendChild(option);

    // set the options for the remaining html elements
    let index = 1;
    for (let val of midiInputs) {
      option = document.createElement("option");
      option.text = val.name;
      option.value = index;
      inputSelector.appendChild(option);
      index++;
    };

  });
}

// ------------------------------------------------------------
// callback for when a MIDI event is received
// ------------------------------------------------------------

function onMIDIMessage(message) {
  // mask the lowest nibble since we don't care about which MIDI channel we receive from
  const op = message.data[0] & 0xf0;
  // a note on is only a note on if it has a non-zero velocity
  if (op === MIDI_NOTE_ON && message.data[2] != 0) {
    // blip the orange dot
    blipDot();
    // note number
    const midiNoteNumber = message.data[1];
    // convert velocity to the range [0,1]
    const velocity = message.data[2] / 127.0;
    // play the note
    playNote(midiNoteNumber, velocity);
  }
  // a note off is a note off, or a note on with zero velocity
  if (op === MIDI_NOTE_OFF || (op === MIDI_NOTE_ON && message.data[2] === 0)) {
    const midiNoteNumber = message.data[1];
    stopNote(midiNoteNumber);
  }
  // midi controller
  if (op === 0xB0) {
    const controllerNumber = message.data[1];
    const controllerValue = message.data[2] / 127;
    // console.log(`CC ${controllerNumber} ${controllerValue}`);
    let param = controlMap.get(controllerNumber);
    if (param != undefined) {
      // console.log(param);
      let el = gui("slider-" + param);
      let value = parseFloat(el.min) + (parseFloat(el.max) - parseFloat(el.min)) * controllerValue;
      //console.log(value);
      setFloatControl(param, value);
      makeImmediateTweak(param,value);
    }

  }
}

// ------------------------------------------------------------
// Blip the orange dot for a short time
// ------------------------------------------------------------

function blipDot() {
  midiDot.style.opacity = 1;
  setTimeout(() => {
    midiDot.style.opacity = 0;
  }, DOT_DURATION_MS);
}


// ------------------------------------------------------------
// play a note
// ------------------------------------------------------------

function playNote(midiNoteNumber, velocity) {
  if (generator != undefined && generator.isValid) {
    let player = playerForNote.get(midiNoteNumber);
    // possibly we triggered the same note during the release phase of an existing note
    // in which case we must stop it and release the object
    if (player != undefined) {
      player.stopAfterRelease(context.currentTime);
      playerForNote.delete(midiNoteNumber);
      monitor.release("note");
    }
    // get the pitch and parameters
    const pitchHz = midiNoteToFreqHz(midiNoteNumber);
    const params = getParametersForGenerator(generator);
    // make a player and store a reference to it so we can stop it later
    player = new BleepPlayer(context, generator, pitchHz, velocity, params);
    if (VERBOSE) console.log(player);
    playerForNote.set(midiNoteNumber, player);
    player.out.connect(reverb.in);
    player.out.connect(scope.in);
    player.start(context.currentTime);
    monitor.retain("note");
    scope.resetRMS();
  }
}

// ------------------------------------------------------------
// stop a note
// ------------------------------------------------------------

function stopNote(midiNoteNumber) {
  let player = playerForNote.get(midiNoteNumber);
  if (player != undefined) {
    player.stopAfterRelease(context.currentTime);
    playerForNote.delete(midiNoteNumber);
    monitor.release("note");
  }
}

// ------------------------------------------------------------
// read all the parameters for this synth from the interface
// ------------------------------------------------------------

function getParametersForGenerator(s) {
  let params = {};
  for (let p of s.parameters) {
    if (p.type === "float") {
      params[p.name] = getFloatParam("slider-" + p.name);
    } else if (p.type === "int") {
      params[p.name] = getIntParam("slider-" + p.name);
    }
  }
  return params;
}

// ------------------------------------------------------------
// make the grammar
// ------------------------------------------------------------

function makeGrammar() {

  // get the grammar source, written in Ohm
  const source = getGrammarSource();

  let modules;
  let patches;
  let tweaks;
  let controls;

  // make the grammar
  synthGrammar = ohm.grammar(source);
  semantics = synthGrammar.createSemantics();

  // list of control parameters

  semantics.addOperation("interpret", {
    Graph(a, b) {
      modules = new Map();
      patches = new Map();
      tweaks = [];
      // always have access to pitch and level
      controls = ["pitch", "level"];
      return `{"synth":{${a.interpret()}},"statements":[${"".concat(b.children.map(z => z.interpret()))}]}`;
    },
    Synthblock(a, b, c, d, e, f, g, h) {
      return `${b.interpret()},${c.interpret()},${d.interpret()},${e.interpret()},${f.interpret()},${g.interpret()}`;
    },
    Parameter(a, b, c, d, e, f, g, h, i, j) {
      return `{"param":{${b.interpret()},${c.interpret()},${d.interpret()},${e.interpret()},${f.interpret()},${g.interpret()},${h.interpret()},${i.interpret()}}}`;
    },
    Paramtype(a, b, c) {
      return `"type":"${c.interpret()}"`;
    },
    Mutable(a, b, c) {
      return `"mutable":"${c.sourceString}"`;
    },
    validtype(a) {
      return a.sourceString;
    },
    Paramstep(a, b, c) {
      return `"step":${c.interpret()}`;
    },
    Minval(a, b, c) {
      return `"min":${c.interpret()}`;
    },
    Maxval(a, b, c) {
      return `"max":${c.interpret()}`;
    },
    Defaultval(a, b, c) {
      return `"default":${c.interpret()}`;
    },
    paramname(a, b) {
      let controlname = a.sourceString + b.sourceString;
      controls.push(controlname);
      return `"name":"${controlname}"`;
    },
    shortname(a, b) {
      return `"shortname":"${a.sourceString}${b.sourceString}"`;
    },
    Longname(a, b, c) {
      return `"longname":${c.interpret()}`;
    },
    Type(a, b, c) {
      return `"type":"${c.interpret()}"`;
    },
    Patchtype(a) {
      return a.sourceString;
    },
    Author(a, b, c) {
      return `"author":${c.interpret()}`;
    },
    Version(a, b, c) {
      return `"version":${c.interpret()}`;
    },
    Docstring(a, b, c) {
      return `"doc":${c.interpret()}`;
    },
    string(a, b) {
      return `"${a.sourceString}${b.sourceString}"`;
    },
    versionstring(a) {
      return `"${a.sourceString}"`;
    },
    inputparam(a) {
      return a.sourceString;
    },
    outputparam(a) {
      return a.sourceString;
    },
    Patch(a, b, c) {
      const from = a.interpret();
      const to = c.interpret();
      if (patches.get(from) === to)
        throwError(`duplicate patch connection`, this.source);
      const fromObj = JSON.parse(from);
      const toObj = JSON.parse(to);
      if (fromObj.id === toObj.id)
        throwError(`cannot patch a module into itself`, this.source);
      patches.set(from, to);
      return `{"patch":{"from":${from},"to":${to}}}`;
    },
    patchoutput(a, b, c) {
      const id = a.interpret();
      const param = c.interpret();
      if (id != "audio") { // audio out
        if (!modules.has(id))
          throwError(`a module called "${id}" has not been defined"`, this.source);
        const type = modules.get(id);
        if (!validPatchOutputs[type].includes(param))
          throwError(`cannot patch the parameter "${param}" of module "${id}"`, this.source);
      }
      return `{"id":"${id}","param":"${param}"}`;
    },
    patchinput(a, b, c) {
      const id = a.interpret();
      const param = c.interpret();
      if (id != "audio") { // audio in
        if (!modules.has(id))
          throwError(`a module called "${id}" has not been defined`, this.source);
        const type = modules.get(id);
        if (!validPatchInputs[type].includes(param))
          throwError(`cannot patch the parameter "${param}" of module "${id}"`, this.source);
      }
      return `{"id":"${id}","param":"${param}"}`;
    },
    Tweak(a, b, c) {
      let tweakedParam = a.interpret();
      let obj = JSON.parse(`{${tweakedParam}}`);
      let twk = `${obj.id}.${obj.param}`;
      // check that this is a valid tweak
      let type = modules.get(obj.id);
      if (!validTweaks[type].includes(obj.param))
        throwError(`cannot set the parameter "${obj.param}" of module "${obj.id}"`, this.source);
      if (tweaks.includes(twk))
        throwError(`you cannot set the value of ${twk} more than once`, this.source);
      tweaks.push(twk);
      return `{"tweak":{${tweakedParam},${c.interpret()}}}`;
    },
    comment(a, b) {
      return `{"comment":"${b.sourceString.trim()}"}`;
    },
    tweakable(a, b, c) {
      let id = a.interpret();
      if (!modules.has(id))
        throwError(`the module "${id}" has not been defined`, this.source);
      return `"id":"${id}", "param":"${c.sourceString}"`;
    },
    varname(a, b) {
      return a.sourceString + b.sourceString;
    },
    Declaration(a, b, c) {
      const type = a.interpret();
      const id = c.interpret();
      if (modules.has(id))
        throwError(`module "${id}" has already been defined`, this.source);
      modules.set(id, type);
      return `{"module":{"type":"${type}","id":"${id}"}}`;
    },
    module(a) {
      return a.sourceString;
    },
    Exp(a) {
      return `"expression":"${a.interpret()}"`;
    },
    AddExp(a) {
      return a.interpret();
    },
    AddExp_add(a, b, c) {
      return `${a.interpret()}+${c.interpret()}`;
    },
    AddExp_subtract(a, b, c) {
      return `${a.interpret()}-${c.interpret()}`;
    },
    MulExp(a) {
      return a.interpret();
    },
    MulExp_times(a, b, c) {
      return `${a.interpret()}*${c.interpret()}`
    },
    MulExp_divide(a, b, c) {
      return `${a.interpret()}/${c.interpret()}`
    },
    ExpExp_paren(a, b, c) {
      return `(${b.interpret()})`;
    },
    ExpExp_neg(a, b) {
      return `-${b.interpret()}`;
    },
    ExpExp(a) {
      return a.interpret();
    },
    Function_map(a, b, c, d, e, f, g, h) {
      return `map(${c.interpret()},${e.interpret()},${g.interpret()})`;
    },
    Function_random(a, b, c, d, e, f) {
      return `random(${c.interpret()},${e.interpret()})`
    },
    Function_exp(a, b, c, d) {
      return `exp(${c.interpret()})`
    },
    Function_log(a, b, c, d) {
      return `log(${c.interpret()})`
    },
    number(a) {
      return a.interpret();
    },
    integer(a, b) {
      const sign = (a.sourceString == "-") ? -1 : 1;
      return sign * parseInt(b.sourceString);
    },
    floatingpoint(a, b, c, d) {
      const sign = (a.sourceString == "-") ? -1 : 1;
      return sign * parseFloat(b.sourceString + "." + d.sourceString);
    },
    control(a, b, c, d) {
      let ctrl = c.sourceString + d.sourceString;
      if (!controls.includes(ctrl))
        throwError(`control parameter "${ctrl}" has not been defined`, this.source);
      return `param.${ctrl}`;
    }
  });

}

// ------------------------------------------------------------
// throw an error message with a line number
// ------------------------------------------------------------

function throwError(msg, source) {
  var line = getErrorLineNumber(source);
  throw new Error(`Line ${line}:\n${msg}`);
}

// ------------------------------------------------------------
// work out the line number where the error occurred, by counting newlines
// ------------------------------------------------------------

function getErrorLineNumber(source) {
  const textBeforeInterval = source.sourceString.substring(0, source.startIdx);
  const lineCount = (textBeforeInterval.match(/\n/g) || []).length;
  return lineCount + 1;
}

// ------------------------------------------------------------
// helper function to get the grammar source, written in Ohm
// ------------------------------------------------------------

function getGrammarSource() {
  return String.raw`
  Synth {

  Graph = Synthblock Statement+

  Parameter = "@param" paramname Paramtype Mutable Paramstep Minval Maxval Defaultval Docstring "@end"

  Synthblock = "@synth" shortname Longname Type Author Version Docstring "@end"

  shortname = letter (letter | "-")+

  paramname = letter (alnum | "_")+

  Mutable (a yes or no value)
  = "mutable" ":" yesno

  yesno = "yes" | "no"

  Paramtype (a parameter type)
  = "type" ":" validtype

  Paramstep (a parameter step value)
  = "step" ":" number

  validtype (a valid type)
  = "float" | "int"

  Longname (a long name)
  = "longname" ":" string

  Type (a patch type)
  = "type" ":" Patchtype

  Patchtype (a synth or effect type)
  = "synth" | "effect"

  Minval (a minimum value)
  = "min" ":" number

  Maxval (a maximum value)
  = "max" ":" number

  Defaultval (a default value)
  = "default" ":" number

  Author (an author)
  = "author" ":" string

  Version (a version string)
  = "version" ":" versionstring

  Docstring (a documentation string)
  = "doc" ":" string

  versionstring (a version string)
  = (alnum | "." | "-" | " ")+

  string (a string)
  = letter (alnum | "." | "," | "-" | " " | "(" | ")" )*

  quote (a quote)
  = "\""

  Statement = comment
  | Parameter
  | Patch
  | Tweak
  | Declaration

  Patch = patchoutput "->" (patchinput | audio)

  patchoutput = varname "." outputparam

  patchinput = varname "." inputparam

  inputparam = "levelCV" | "pitchCV" | "indexCV" | "in" | "cutoffCV" | "pulsewidthCV" | "angleCV" | "lagCV" | "thresholdCV" | "symmetryCV" | "gainCV"

  outputparam = "out"

  audio = "audio.in"

  comment (a comment)
  = "#" commentchar*

  commentchar = alnum | "." | "+" | "-" | "/" | "*" | "." | ":" | blank

  Tweak = tweakable "=" Exp

  Declaration = module ":" varname

  module = "SAW-OSC"
  | "SIN-OSC"
  | "SQR-OSC"
  | "TRI-OSC"
  | "PULSE-OSC"
  | "WAVE-OSC"
  | "LFO"
  | "NOISE"
  | "LPF"
  | "HPF"
  | "VCA"
  | "SHAPER"
  | "ADSR"
  | "DECAY"
  | "PAN"
  | "DELAY"
  | "FOLDER"

  Exp
    = AddExp

  AddExp
    = AddExp "+" MulExp  -- add
  | AddExp "-" MulExp  -- subtract
  | MulExp

  MulExp
    = MulExp "*" ExpExp -- times
    | MulExp "/" ExpExp -- divide
    | ExpExp

  ExpExp
    = "(" AddExp ")" -- paren
    | "-" ExpExp -- neg
    | Function
    | number
    | control

  Function
    = "map" "(" AddExp "," number "," number ")" -- map
    | "random" "(" number "," number ")" -- random
    | "exp" "(" AddExp ")" -- exp
    | "log" "(" AddExp ")" -- log

  control (a control parameter)
  = "param" "." letter (alnum | "_")+

  tweakable
  = varname "." parameter

  parameter = "pitch" | "detune" | "index" | "level" | "lag" | "phase" | "angle" | "cutoff" | "resonance" | "attack" | "decay" | "sustain" | "release" | "fuzz" | "pulsewidth" | "threshold" | "symmetry" | "gain" | "stages"

  varname (a module name)
  = lower alnum*

  number (a number)
  = floatingpoint | integer

  floatingpoint = "-"? digit+ "." digit+

  integer = "-"? digit+

  blank = " "

}
`;
}

// ------------------------------------------------------------
// parse the description to make a generator
// ------------------------------------------------------------

function parseGeneratorSpec() {
  if (VERBOSE) console.log("parsing");
  generator = null;
  let result = synthGrammar.match(gui("synth-spec").value + "\n");
  if (result.succeeded()) {
    try {
      if (VERBOSE) console.log("parsed OK");
      gui("parse-errors").value = "OK";
      const adapter = semantics(result);
      const json = adapter.interpret();
      createControls(json);
      currentJSON = convertToStandardJSON(json);
      generator = new BleepGenerator(currentJSON);
      // new bit - draw as mermaid graph
      generator.drawGraphAsMermaid();
      // was there a warning?
      if (generator.hasWarning) {
        gui("parse-errors").value += "\n" + generator.warningString;
      }
    } catch (error) {
      gui("parse-errors").value = error.message;
    }
  } else {
    gui("parse-errors").value = result.message;
    if (VERBOSE) console.log(result);
  }
}

// ------------------------------------------------------------
// create the controls for this synth
// ------------------------------------------------------------

function createControls(json) {
  const obj = JSON.parse(json);
  removeAllSliders();
  controlMap = new Map();
  let count = 0;
  let row = 1;
  for (const m of obj.statements) {
    // find all the parameters
    if (m.param) {
      let p = m.param;
      // we map the first few sliders to the preferred list of MIDI controllers
      if (count < MIDI_CONTROLLERS.length) {
        controlMap.set(MIDI_CONTROLLERS[count], p.name);
      }
      if (count > 11) {
        row = 2;
      }
      makeSlider(`container${row}`, p.name, p.doc, p.min, p.max, p.default, p.step);
      count++;
    }
  }
}

// ------------------------------------------------------------
// convert the raw JSON from the parser into a standard JSON form that could
// also be used to describe other kinds of synths
// ------------------------------------------------------------

function convertToStandardJSON(json) {
  // we need to put the JSON from the grammar into a standard format
  const tree = JSON.parse(json);
  var std = {};
  std.longname = tree.synth.longname;
  std.shortname = tree.synth.shortname;
  std.version = tree.synth.version;
  std.author = tree.synth.author;
  std.doc = tree.synth.doc;
  std.prototype = "builder";
  std.modules = [];
  // filter the statements into the right structures
  const statements = tree.statements;
  for (let i = 0; i < statements.length; i++) {
    let obj = statements[i];
    if (obj.module) {
      std.modules.push(obj.module);
    } else if (obj.patch) {
      // find the type of the from id
      let found = std.modules.find((a) => (a.id === obj.patch.from.id));
      const type = found.type;
      // we treat envelopes differently for efficiency reasons
      if (type === "ADSR" || type === "DECAY") {
        if (!std.envelopes) {
          std.envelopes = [];
        }
        std.envelopes.push(obj.patch);
      } else {
        if (!std.patches) {
          std.patches = [];
        }
        std.patches.push(obj.patch);
      }
    } else if (obj.param) {
      if (!std.parameters) {
        std.parameters = [];
      }
      std.parameters.push(obj.param);
    } else if (obj.tweak) {
      if (!std.tweaks) {
        std.tweaks = [];
      }
      var mytweak = {};
      mytweak.id = obj.tweak.id;
      mytweak.param = obj.tweak.param;
      mytweak.expression = convertToPostfix(obj.tweak.expression);
      std.tweaks.push(mytweak);
    }
  }
  return JSON.stringify(std);
}

// ------------------------------------------------------------
// convert an infix expression to postfix
// ------------------------------------------------------------

function convertToPostfix(expression) {
  // shunting yard algorithm with functions
  const ops = { "+": 1, "-": 1, "*": 2, "/": 2 };
  const funcs = { "log": 1, "exp": 1, "random": 1, "map": 1 };
  // split the expression
  const tokens = expression.split(/([\*\+\-\/\,\(\)])/g).filter(x => x);
  // deal with unary minus
  // is there a minus at the start?
  if ((tokens.length > 1) && (tokens[0] == "-") && isNumber(tokens[1])) {
    tokens.shift();
    let n = parseFloat(tokens.shift());
    tokens.unshift(`${-1 * n}`);
  }
  // is there a minus after a bracket or other operator?
  if (tokens.length > 2) {
    for (let i = 1; i < tokens.length - 1; i++) {
      let pre = tokens[i - 1];
      let mid = tokens[i];
      let post = tokens[i + 1];
      if ((mid == "-") && isNumber(post) && ((pre == "(") || (pre in ops))) {
        let n = -1 * parseFloat(post);
        tokens[i + 1] = `${n}`;
        tokens.splice(i, 1);
      }
    }
  }
  let top = (s) => s[s.length - 1];
  let stack = [];
  let result = [];
  for (let t of tokens) {
    if (isNumber(t) || isIdentifier(t)) {
      result.push(t);
    } else if (t == "(") {
      stack.push(t);
    } else if (t == ")") {
      while (top(stack) != "(") {
        let current = stack.pop();
        result.push(current);
      }
      stack.pop();
      if (stack.length > 0) {
        if (top(stack) in funcs) {
          let current = stack.pop();
          result.push(current);
        }
      }
    } else if (t in funcs) {
      stack.push(t);
    } else if (t == ",") {
      while (top(stack) != "(") {
        let current = stack.pop();
        result.push(current);
      }
    } else if (t in ops) {
      // deal with unary minus
      while ((stack.length > 0) && (top(stack) in ops) && (ops[top(stack)] >= ops[t])) {
        let current = stack.pop();
        result.push(current);
      }
      stack.push(t);
    }
  }
  while (stack.length > 0) {
    let current = stack.pop();
    if (current != ",") {
      result.push(current);
    }
  }
  return result;
}

// ------------------------------------------------------------
// is this token a number?
// ------------------------------------------------------------

function isNumber(t) {
  return !isNaN(parseFloat(t)) && isFinite(t);
}

// ------------------------------------------------------------
// is this token an identifier?
// ------------------------------------------------------------

function isIdentifier(t) {
  return (typeof t === "string") && (t.startsWith("param."));
}

// ------------------------------------------------------------
// helper function to get a module instance
// neat trick for dynamic object creation from string name:
// https://stackoverflow.com/questions/1366127/how-do-i-make-javascript-object-using-a-variable-string-to-define-the-class-name
// ------------------------------------------------------------

function getModuleInstance(ctx, type) {
  return new moduleContext[moduleClasses[type]](ctx);
}

// ------------------------------------------------------------
// Bleep Generator class
// ------------------------------------------------------------

class BleepGenerator {

  #isValid
  #hasWarning
  #longname
  #shortname
  #version
  #author
  #doc
  #modules
  #patches
  #tweaks
  #envelopes
  #parameters
  #maxima
  #minima
  #defaults
  #mutable
  #errorString
  #warningString

  constructor(json) {
    const tree = JSON.parse(json);
    this.#longname = tree.longname;
    this.#shortname = tree.shortname;
    this.#version = tree.version;
    this.#author = tree.author;
    this.#doc = tree.doc;
    this.#modules = tree.modules || [];
    this.#patches = tree.patches || [];
    this.#tweaks = tree.tweaks || [];
    this.#envelopes = tree.envelopes || [];
    this.#parameters = tree.parameters || [];
    this.#isValid = true;
    this.#hasWarning = false;
    this.#errorString = "";
    this.#warningString = "";
    // find the maxima and minima of all parameters and store them
    // but we need to store information about max/min pitch and level
    this.#maxima = {};
    this.#maxima.pitch = MAX_MIDI_NOTE;
    this.#maxima.level = MAX_LEVEL;
    this.#minima = {};
    this.#minima.pitch = MIN_MIDI_NOTE;
    this.#minima.level = MIN_LEVEL;
    this.#defaults = {};
    this.#mutable = {};
    for (let m of this.#parameters) {
      this.#mutable[m.name] = (m.mutable === "yes");
      this.#maxima[m.name] = m.max;
      this.#minima[m.name] = m.min;
      this.#defaults[m.name] = m.default;
    }
    try {
      this.checkForErrors();
    } catch (error) {
      this.#isValid = false;
      this.#errorString = error.message;
    }
    this.checkForWarnings();
  }

  // check for errors

  checkForErrors() {
    // nothing is patched
    if (this.#patches.length == 0)
      throw new Error("BleepGenerator error: nothing is patched");
    // no modules have been added
    if (this.#modules.length == 0)
      throw new Error("BleepGenerator error: no modules have been added");
    // nothing is patched to audio in
    if (!this.hasPatchTo("audio", "in"))
      throw new Error("BleepGenerator error: nothing is patched to audio.in");
  }

  // find the module type for a given ID

  findModuleForID(id) {
    let m = this.#modules.find(val => (val.id === id));
    if (m === undefined)
      throw new Error(`BleepGenerator error: trying to set unknown control "${id}"`);
    return m.type;
  }

  // we might warn the user about some stuff, like nothing patched from keyboard.pitch

  checkForWarnings() {
    // have the pitch and level been assigned to anything?
    let msg = "";
    for (let param of ["pitch", "level"]) {
      if (!this.hasTweakWithValue(`param.${param}`))
        msg += `BleepGenerator warning: you haven't assigned param.${param} to a control\n`;
    }
    // has something been patched to audio.in?
    if (this.hasPatchTo("audio", "in") == false)
      msg += `BleepGenerator warning: you haven't patched anything to audio.in\n`;
    // check that parameters have reasonable values
    for (let obj of this.#parameters) {
      if (obj.max < obj.min)
        msg += `BleepGenerator warning: max of parameter ${obj.name} is less than min\n`;
      if (obj.default < obj.min)
        msg += `BleepGenerator warning: default of parameter ${obj.name} is less than min\n`;
      if (obj.default > obj.max)
        msg += `BleepGenerator warning: default of parameter ${obj.name} is greater than max\n`;
    }
    // throw the warning if we have one
    if (msg.length > 0)
      this.throwWarning(msg);
  }

  // determine if this generator has a patch cable to the given node

  hasPatchTo(node, param) {
    return this.#patches.some(val => (val.to.id === node && val.to.param === param));
  }

  // determine if this generator has a patch cable from the given node

  hasPatchFrom(node, param) {
    return this.#patches.some(val => (val.from.id === node && val.from.param === param));
  }

  // check for a tweak with a given value (for keyboard checks)
  hasTweakWithValue(value) {
    return this.#tweaks.some(val => (val.expression.includes(value)));
  }

  // register a warning message

  throwWarning(msg) {
    this.#hasWarning = true;
    this.#warningString = msg;
  }

  drawGraphAsMermaid() {
    var element = gui("mermaid-graph");
    // get rid of all the kids
    while (element.firstChild) {
      element.removeChild(element.firstChild);
    }
    // mermaid callback that inserts a svg into the HTML
    var insertSvg = function (svg, bindFunctions) {
        element.innerHTML = svg.svg;
        bindFunctions?.(element);
    };
    // get this generator in mermaid form, with a fishy tail and all
    var graphDefinition = this.getGraphAsMermaid();
    // mermaid transforms our graph description into a svg
    var graph = mermaid.render('graph-id', graphDefinition).then(insertSvg);
  }

  getGraphAsMermaid() {
    var doc = `graph TD;\n`;
    // modules
    Object.values(this.#patches).forEach(patch => {
      const fromString = this.nodeToMarkdown(patch.from.id);
      const toString = this.nodeToMarkdown(patch.to.id);
      doc += `   ` + fromString + `-->` + toString + `;\n`;
    });
    // envelopes
    Object.values(this.#envelopes).forEach(patch => {
      const fromString = this.nodeToMarkdown(patch.from.id);
      const toString = this.nodeToMarkdown(patch.to.id);
      doc += `   ` + fromString + `-.->` + toString + `;\n`;
    });
    return doc;
  }

  getDocumentationAsMarkdownString() {
    const code = "\`\`\`";
    var doc = `## ${this.#longname} (${code}${this.#shortname}${code})\n`;
    doc += `${this.#doc}\n\n`;
    doc += `Author: ${this.#author}\n\n`;
    doc += `### Parameters\n\n`;
    doc += `| parameter | minimum | maximum | default | description |\n`;
    doc += `| --------- | ------- | ------- | ------- | ----------- |\n`;
    Object.values(this.#parameters).forEach(param => {
      doc += `| ${code}${param.name}${code} | ${param.min} | ${param.max} | ${param.default} | ${param.doc} |\n`;
    });
    doc += `### WebAudio graph\n`;
    doc += `${code}mermaid\n`;
    doc += `graph TD;\n`;
    // modules
    Object.values(this.#patches).forEach(patch => {
      const fromString = this.nodeToMarkdown(patch.from.id);
      const toString = this.nodeToMarkdown(patch.to.id);
      doc += `   ` + fromString + `-->` + toString + `;\n`;
    });
    // envelopes
    Object.values(this.#envelopes).forEach(patch => {
      const fromString = this.nodeToMarkdown(patch.from.id);
      const toString = this.nodeToMarkdown(patch.to.id);
      doc += `   ` + fromString + `-.->` + toString + `;\n`;
    });
    doc += `${code}\n`;
    doc += `### Examples\n`;
    return doc;
  }

  nodeToMarkdown(id) {
    let str;
    let leftBracket = "(";
    let rightBracket = ")";
    if (id == "audio") {
      str = id;
    } else {
      const type = this.getTypeForID(id);
      switch (type) {
        case "SAW-OSC": case "SIN-OSC": case "SQR-OSC": case "TRI-OSC": case "PULSE-OSC": case "LFO":
          leftBracket = "([";
          rightBracket = "])";
          break;
        case "LPF": case "HPF":
          leftBracket = "[";
          rightBracket = "]";
          break;
        case "DECAY": case "ADSR":
          leftBracket = "[/";
          rightBracket = "\\]";
          break;
      }
      str = `${type}:${id}`;
    }
    str = `${id}_id` + leftBracket + `"${str}"` + rightBracket;
    return str;
  }

  getTypeForID(id) {
    for (let i = 0; i < this.#modules.length; i++) {
      if (this.#modules[i].id === id) {
        return this.#modules[i].type;
      }
    }
    return null;
  }

  // get the long name of the generator

  get longname() {
    return this.#longname;
  }

  // get the short name of the generator

  get shortname() {
    return this.#shortname;
  }

  // get the version of the generator

  get version() {
    return this.#version;
  }

  // get the author of the generator

  get author() {
    return this.#author;
  }

  // get the doc string of the generator

  get doc() {
    return this.#doc;
  }

  module(i) {
    return this.#modules[i];
  }

  patch(i) {
    return this.#patches[i];
  }

  tweak(i) {
    return this.#tweaks[i];
  }

  envelope(i) {
    return this.#envelopes[i];
  }

  get maxima() {
    return this.#maxima;
  }

  get minima() {
    return this.#minima;
  }

  get mutable() {
    return this.#mutable;
  }

  get modules() {
    return this.#modules;
  }

  // get the list of patch points

  get patches() {
    return this.#patches;
  }

  // get the list of tweaks

  get tweaks() {
    return this.#tweaks;
  }

  get envelopes() {
    return this.#envelopes;
  }

  // get the list of parameters

  get parameters() {
    return this.#parameters;
  }

  get defaults() {
    return this.#defaults
  }

  // is the generator valid?

  get isValid() {
    return this.#isValid;
  }

  // did we have any warnings?

  get hasWarning() {
    return this.#hasWarning;
  }

  // get a string representing the error

  get errorString() {
    return this.#errorString;
  }

  // get a string representing the warning

  get warningString() {
    return this.#warningString;
  }

}

// ------------------------------------------------------------
// make a reverb unit and connect it to the audio output
// ------------------------------------------------------------

// bleep generator doesnt need the context

class BleepPlayer {

  node
  context
  generator
  params

  constructor(ctx, generator, pitchHz, level, params) {
    this.context = ctx;
    this.generator = generator;
    this.params = params;
    this.node = {};
    // add the pitch and level to the parameters
    params.pitch = pitchHz;
    params.level = level;
    // create the webaudio network in three steps
    this.createModules();
    this.createPatches();
    this.applyTweaks();
  }

  createModules() {
    // make a webaudio object for each node
    for (let m of this.generator.modules) {
      this.node[m.id] = getModuleInstance(this.context, m.type);
    }
    // we always need an audio object for output
    this.node["audio"] = getModuleInstance(this.context, "VCA");
  }

  // connect all the patch cables
  createPatches() {
    for (let p of this.generator.patches) {
      let fromModule = this.node[p.from.id];
      let toModule = this.node[p.to.id];
      fromModule[p.from.param].connect(toModule[p.to.param]);
    }
  }

  // do all the parameter tweaks
  applyTweaks() {
    for (let t of this.generator.tweaks) {
      let obj = this.node[t.id];
      let val = this.evaluatePostfix(t.expression);
      obj[t.param] = val;
    }
  }

  // apply one tweak now as an instantaneous change
  // you can only do this to parameters that have been identified as mutable
  applyTweakNow(param, value) {
    // is the parameter mutable?
    if (this.generator.mutable[param] === false)
      return;
    // update the parameter set with the value
    this.params[param] = value;
    // update any expressions that use the tweaked parameter
    for (let t of this.generator.tweaks) {
      if (t.expression.includes(`param.${param}`)) {
        let obj = this.node[t.id];
        let val = this.evaluatePostfix(t.expression);
        obj[t.param] = val;
      }
    }
  }

  start(when) {
    // apply the envelopes
    for (let e of this.generator.envelopes) {
      let env = this.node[e.from.id];
      let obj = this.node[e.to.id];
      env.apply(obj[e.to.param], when);
    }
    // start all the nodes that have a start function
    Object.values(this.node).forEach((m) => {
      m.start?.(when);
    });
  }

  // stop the webaudio network right now
  stopImmediately() {
    if (VERBOSE) console.log("stopping immediately");
    let now = context.currentTime;
    Object.values(this.node).forEach((m) => {
      m.stop?.(now);
    });
  }

  // stop the webaudio network only after the release phase of envelopes has completed
  stopAfterRelease(when) {
    if (VERBOSE) console.log("stopping after release");
    let longestRelease = 0;
    Object.values(this.node).forEach((m) => {
      if (m.release) {
        m.releaseOnNoteOff(when);
        if (m.release > longestRelease)
          longestRelease = m.release;
      }
    });
    // stop after the longest release time
    Object.values(this.node).forEach((m) => {
      m.stop?.(when + longestRelease);
    });
  }

  get out() {
    return this.node.audio.out;
  }

  // evaluate a parameter expression in postfix form
  evaluatePostfix(expression) {
    let stack = [];
    const popOperand = () => {
      let op = stack.pop();
      if (isIdentifier(op)) {
        op = this.params[op.replace("param.", "")];
      }
      return op;
    }
    for (let t of expression) {
      if (isNumber(t)) {
        stack.push(parseFloat(t));
      } else if (isIdentifier(t)) {
        stack.push(t);
      } else if (t === "*" || t === "/" || t === "+" || t == "-") {
        let op2 = popOperand();
        let op1 = popOperand();
        switch (t) {
          case "*": stack.push(op1 * op2); break;
          case "/": stack.push(op1 / op2); break;
          case "+": stack.push(op1 + op2); break;
          case "-": stack.push(op1 - op2); break;
        }
      } else if (t === "log") {
        let op = popOperand();
        stack.push(Math.log(op));
      } else if (t === "exp") {
        let op = popOperand();
        stack.push(Math.exp(op));
      } else if (t === "random") {
        let op1 = stack.pop();
        let op2 = stack.pop();
        let r = randomBetween(op2, op1);
        stack.push(r);
      } else if (t === "map") {
        let op1 = stack.pop();
        let op2 = stack.pop();
        let op3 = stack.pop();
        let control = op3.replace("param.", "");
        let value = this.params[control];
        // mapping pitch in this way doesnt work well, so 
        // convert to midi note number
        if (control=="pitch") {
          value = freqHztoMidiNote(value);
        }
        let minval = this.generator.minima[control];
        let maxval = this.generator.maxima[control];
        let s = scaleValue(minval, maxval, op2, op1, value);
        console.log(s);
        stack.push(s);
      }
    }
    let result = stack[0];
    if (isIdentifier(result))
      return this.params[result.replace("param.", "")];
    else
      return result;
  }

}

// ------------------------------------------------------------
// make a reverb unit and connect it to the audio output
// ------------------------------------------------------------

async function connectEffects(ctx) {
  reverb = new Reverb(ctx);
  await reverb.load("./impulses/medium-hall.wav");
  reverb.out.connect(ctx.destination);
}

// ------------------------------------------------------------
// Convolutional reverb class
// ------------------------------------------------------------

class Reverb {

  #in
  #out
  #context
  #isValid
  #wetLevel
  #wetGain
  #dryGain
  #reverb

  constructor(ctx) {
    this.#context = ctx;
    this.#isValid = false;
    this.#wetLevel = 0.5
    this.#reverb = this.#context.createConvolver();
    this.#wetGain = this.#context.createGain();
    this.#dryGain = this.#context.createGain();
    this.#in = this.#context.createGain();
    this.#in.gain.value = 1;
    this.#out = this.#context.createGain();
    this.#out.gain.value = 1;
    this.#wetGain.gain.value = this.#wetLevel;
    this.#dryGain.gain.value = 1 - this.#wetLevel;
    // connect everything up
    this.#in.connect(this.#reverb);
    this.#reverb.connect(this.#wetGain);
    this.#in.connect(this.#dryGain);
    this.#wetGain.connect(this.#out);
    this.#dryGain.connect(this.#out);
  }

  async load(filename) {
    const impulseResponse = await this.getImpulseResponseFromFile(filename);
    if (this.#isValid) {
      this.#reverb.buffer = impulseResponse;
    }
  }

  async getImpulseResponseFromFile(filename) {
    try {
      let reply = await fetch(filename);
      this.#isValid = true;
      return this.#context.decodeAudioData(await reply.arrayBuffer());
    } catch (err) {
      this.#isValid = false;
      console.log("unable to load the impulse response file called " + filename);
    }
  }

  set wetLevel(level) {
    this.#wetLevel = clamp(level, 0, 1);
    this.#wetGain.gain.value = this.#wetLevel;
    this.#dryGain.gain.value = 1 - this.#wetLevel;
  }

  get in() {
    return this.#in
  }

  get out() {
    return this.#out;
  }

}

// ------------------------------------------------------------
// initialise the effects chain and set default parameters
// ------------------------------------------------------------

function initialiseEffects() {
  setReverb(0.1);
}

// ------------------------------------------------------------
// Set the reverb to a given level
// ------------------------------------------------------------

function setReverb(w) {
  reverb.wetLevel = w;
  setFloatControl("reverb", w);
}

// ------------------------------------------------------------
// Get the document element with a given name
// ------------------------------------------------------------

function gui(name) {
  return document.getElementById(name);
}

// ------------------------------------------------------------
// Get an integer parameter with a given name
// ------------------------------------------------------------

function getIntParam(name) {
  return parseInt(document.getElementById(name).value);
}

// ------------------------------------------------------------
// Get a float parameter with a given name
// ------------------------------------------------------------

function getFloatParam(name) {
  return parseFloat(document.getElementById(name).value);
}

// ------------------------------------------------------------
// load file
// https://developer.chrome.com/articles/file-system-access/
// ------------------------------------------------------------

async function loadFile() {
  [fileHandle] = await window.showOpenFilePicker();
  const file = await fileHandle.getFile();
  const contents = await file.text();
  gui("synth-spec").value = contents;
  gui("file-label").textContent = "Current file: " + fileHandle.name;
  wasEdited = false;
  parseGeneratorSpec();
}

// ------------------------------------------------------------
// save file
// https://developer.chrome.com/articles/file-system-access/
// ------------------------------------------------------------

async function saveFile() {
  if (fileHandle != null) {
    const writable = await fileHandle.createWritable();
    await writable.write(gui("synth-spec").value);
    await writable.close();
    // remove the star
    gui("file-label").textContent = "Current file: " + fileHandle.name;
    wasEdited = false;
  }
}

// ------------------------------------------------------------
// save as file
// https://developer.chrome.com/articles/file-system-access/
// ------------------------------------------------------------

async function saveAsFile() {
  let opts = {};
  if (generator.shortname.length > 0) {
    opts.suggestedName = generator.shortname + ".txt";
  }
  fileHandle = await window.showSaveFilePicker(opts);
  const writable = await fileHandle.createWritable();
  await writable.write(gui("synth-spec").value);
  await writable.close();
  gui("file-label").textContent = "Current file: " + fileHandle.name;
  wasEdited = false;
}

// ------------------------------------------------------------
// export as JSON
// https://developer.chrome.com/articles/file-system-access/
// ------------------------------------------------------------

async function exportAsJSON() {
  if (generator != undefined && generator.isValid) {
    const opts = {
      suggestedName: generator.shortname + ".json"
    };
    fileHandle = await window.showSaveFilePicker(opts);
    const writable = await fileHandle.createWritable();
    await writable.write(currentJSON);
    await writable.close();
  }
}

// ------------------------------------------------------------
// Clamp a value to a maximum and minimum
// https://www.youtube.com/watch?v=g2_zb6oyep8
// ------------------------------------------------------------

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

// ------------------------------------------------------------
// set control to value
// ------------------------------------------------------------

function setFloatControl(label, value) {
  gui("slider-" + label).value = value;
  gui(`label-${label}`).textContent = `${label} [${value.toFixed(2)}]`;
}

// ------------------------------------------------------------
// Make a random number between two values
// ------------------------------------------------------------

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

// ------------------------------------------------------------
// Scale a value p in the range (low,high) to a new range (min,max)
// ------------------------------------------------------------

function scaleValue(low, high, min, max, p) {
  return min + (p - low) * (max - min) / (high - low);
}

// ------------------------------------------------------------
// Helper function - make a unity gain stage
// ------------------------------------------------------------

function unityGain(ctx) {
  const gain = ctx.createGain();
  gain.gain.value = 1;
  return gain;
}

// ------------------------------------------------------------
// Convert MIDI note number to its name and octave
// ------------------------------------------------------------

function midiToNoteName(m) {
  const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  return noteNames[m % 12] + (Math.floor(m / 12) - 1);
}

// ------------------------------------------------------------
// Convert a midi note number to its frequency in Hz
// ------------------------------------------------------------

function midiNoteToFreqHz(m) {
  return 440 * Math.pow(2, (m - 69) / 12.0);
}

// ------------------------------------------------------------
// Convert a frequency in Hz to its MIDI note number
// ------------------------------------------------------------

function freqHztoMidiNote(f) {
  return 69 + 12 * Math.log2(f / 440);
}

// ------------------------------------------------------------
// TEST HARNESS
// ------------------------------------------------------------

// ------------------------------------------------------------
// run a test suite for expression evaluation
// ------------------------------------------------------------

function runTestSuite() {
  let infix = [];
  infix.push("2*param.cutoff");
  infix.push("2+param.cutoff");
  infix.push("param.cutoff+param.resonance");
  infix.push("log(param.cutoff)+exp(param.resonance)");
  infix.push("2");
  infix.push("4/5");
  infix.push("8-5");
  infix.push("param.cutoff/3");
  infix.push("param.cutoff+random(0,1)");
  infix.push("exp(param.cutoff-param.resonance)");
  infix.push("param.pitch");
  infix.push("-1200");
  infix.push("(-1)*2");
  infix.push("2*-4");
  let param = { "cutoff": 2, "resonance": 3, "timbre": 4, "pitch": 50, "level": 0.5 };
  let minima = { "cutoff": 0, "resonance": 0, "timbre": 0, "pitch": 20, "level": 0 };
  let maxima = { "cutoff": 10, "resonance": 10, "timbre": 5, "pitch": 500, "level": 1 };
  for (let item of infix)
    testExpression(item, param, minima, maxima);
}

// ------------------------------------------------------------
// for testing, compare an expression in infix and postfix form
// ------------------------------------------------------------

function testExpression(infix, param, minima, maxima) {
  console.log(infix);
  let postfix = convertToPostfix(infix);
  console.log("".concat(postfix.map(z => `${z}`)));
  infix = infix.replace("log", "Math.log");
  infix = infix.replace("exp", "Math.exp");
  infix = infix.replace("random", "randomBetween");
  infixResult = eval(infix);
  postfixResult = evaluatePostfix(postfix, param, maxima, minima);
  console.log(`infix=${infixResult} postfix=${postfixResult}`);
  console.log("");
}

/**
* =========================================================================
* ScopeView - a line view for the scope (other views are possible ...)
* =========================================================================
*/
class ScopeView {

  _SYNC_WINDOW = 200

  _context
  _width
  _height
  _sync

  /**
   * Make a scope view
   * @param {string} canvas - name of the HTML canvas
   * @param {Object} params - parameters for display and sync
   */
  constructor(canvas, params) {
    this._context = canvas.getContext("2d");
    this._width = canvas.width;
    this._height = canvas.height;
    this._context.fillStyle = (params && params.fillStyle) ? params.fillStyle : "#252525";
    this._context.lineWidth = (params && params.lineWidth) ? params.lineWidth : 2;
    this._context.strokeStyle = (params && params.strokeStyle) ? params.strokeStyle : "#e6983f";
    this._sync = (params && params.sync) ? params.sync : false;
  }

  /**
   *
   * @param {Uint8Array} data - the array to display
   */
  draw(data) {
    let st = 0;
    if (this._sync) {
      st = this.firstZeroCrossing(data);
      if (st > this._SYNC_WINDOW) {
        st = 0;
      }
    }
    const n = data.length - this._SYNC_WINDOW;
    const stepSize = this._width / n;
    this._context.fillRect(0, 0, this._width, this._height);
    let x = 0;
    this._context.beginPath();
    let y = data[st] * this._height / 256;
    this._context.moveTo(x, y);
    for (let i = 1; i < n; i++) {
      y = data[st + i] * this._height / 256;
      this._context.lineTo(x, y);
      x += stepSize;
    }
    this._context.lineTo(this._width, this._height / 2);
    this._context.stroke();

  }

  /**
   *
   * @param {Uint8Array} data  - the array to process
   * @returns an integer index
   */
  firstZeroCrossing(data) {
    let idx = 0;
    while ((idx < (data.length - 2)) && (data[idx] * data[idx + 1] > 0)) {
      idx++;
    }
    return idx;
  }
}

/**
* =========================================================================
* Scope - model-controller for the scope
* =========================================================================
*/
class Scope {

  _analyser
  _dataArray
  _view
  _rms
  _peakRMS

  /**
   * Make a scope model-controller
   * @param {AudioContext} ctx - the audio context
   * @param {ScopeView} view - the scope view
   */
  constructor(ctx, view) {
    this._view = view;
    this._analyser = ctx.createAnalyser();
    this._analyser.fftSize = 1024;
    this._dataArray = new Uint8Array(this._analyser.fftSize);
    this._rms = 0;
    this._peakRMS = 0;
  }

  /**
   * Get a frame of data to display
   */
  get frame() {
    return this._dataArray;
  }

  /**
   * compute the RMS level
   */
  computeRMS() {
    let sum = 0;
    for (let i = 0; i < this._dataArray.length; i++) {
      // put into the range [-1,1]
      const x = this._dataArray[i] / 128 - 1;
      sum += x * x;
    }
    // return root of the mean of the squares
    this._rms = Math.sqrt(sum / this._dataArray.length);
    if (this._rms > this._peakRMS) {
      this._peakRMS = this._rms;
    }
  }

  resetRMS() {
    this._peakRMS = 0;
  }

  /**
  * Draw the data
  * Because we need to refer to this.draw when we request the animation
  * frame, must use an arrow function which retains the surrounding context
  */
  draw = () => {
    this._analyser.getByteTimeDomainData(this._dataArray);
    this.computeRMS();
    this._view.draw(this._dataArray);
    // update the rms information
    gui("rms-label").textContent = "\u00A0\u00A0" + `RMS=${this._rms.toFixed(4)}, Peak RMS=${this._peakRMS.toFixed(4)}`;
    requestAnimationFrame(this.draw);
  }

  /**
   * Get the input node
   */
  get in() {
    return this._analyser;
  }

}