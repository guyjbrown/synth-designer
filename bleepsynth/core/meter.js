import { MonitoredAnalyserNode } from "./monitored_components.js";

export default class Meter {

    static FFT_SIZE = 1024

    #rms
    #peakRMS
    #analyser
    #dataArray
    #buffer
    #clipped = false

    constructor(context, monitor) {
        this.#analyser = new MonitoredAnalyserNode(context, monitor, {
            fftSize: Meter.FFT_SIZE
        });
        this.#buffer = new AudioBuffer({
            length : Meter.FFT_SIZE,
            numberOfChannels : 1,
            sampleRate : context.sampleRate
        });
        this.#dataArray = new Uint8Array(Meter.FFT_SIZE);
        this.reset();
    }

    get in() {
        return this.#analyser
    }

    get out() {
        return this.#analyser
    }

    stop() {
        this.#analyser.disconnect();
        this.#buffer = null;
    }

    reset() {
        this.#rms = 0;
        this.#peakRMS = 0;
        this.#clipped = false;
    }

    get buffer() {
        return this.#buffer;
    }

    get rms() {
        return this.#rms;
    }

    get peakRMS() {
        return this.#peakRMS;
    }

    get clipped() {
        return this.#clipped;
    }

    update() {
        this.#analyser.getByteTimeDomainData(this.#dataArray);
        const data = this.#buffer.getChannelData(0);
        let sumOfSquares = 0;
        for (let i = 0; i < Meter.FFT_SIZE; i++) {
            // put into the range [-1,1]
            data[i] = this.#dataArray[i] / 128 - 1;
            sumOfSquares += data[i] * data[i];
            if (Math.abs(data[i])>0.99) {
                this.#clipped = true;
            }
        }
        this.#rms = Math.sqrt(sumOfSquares / Meter.FFT_SIZE);
        if (this.#rms > this.#peakRMS) {
            this.#peakRMS = this.#rms;
        }
    }

}
