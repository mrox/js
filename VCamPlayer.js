

function appendByteArray(buffer1, buffer2) {
    let tmp = new Uint8Array((buffer1.byteLength|0) + (buffer2.byteLength|0));
    tmp.set(buffer1, 0);
    tmp.set(buffer2, buffer1.byteLength|0);
    return tmp;
}
function appendByteArrayAsync(buffer1, buffer2) {
    return new Promise((resolve, reject)=>{
        let blob = new Blob([buffer1, buffer2]);
        let reader = new FileReader();
        reader.addEventListener("loadend", function() {
            resolve();
        });
        reader.readAsArrayBuffer(blob);
    });
}
 function base64ToArrayBuffer(base64) {
    var binary_string =  window.atob(base64);
    var len = binary_string.length;
    var bytes = new Uint8Array( len );
    for (var i = 0; i < len; i++)        {
        bytes[i] = binary_string.charCodeAt(i);
    }
    return bytes.buffer;
}
function u8ToBase64(u8){
    return btoa(String.fromCharCode.apply(null, u8));
}

 function hexToByteArray(hex) {
    let len = hex.length >> 1;
    var bufView = new Uint8Array(len);
    for (var i = 0; i < len; i++) {
        bufView[i] = parseInt(hex.substr(i<<1,2),16);
    }
    return bufView;
}

 function concatenate(resultConstructor, ...arrays) {
    let totalLength = 0;
    for (let arr of arrays) {
        totalLength += arr.length;
    }
    let result = new resultConstructor(totalLength);
    let offset = 0;
    for (let arr of arrays) {
        result.set(arr, offset);
        offset += arr.length;
    }
    return result;
}

 function bitSlice(bytearray, start=0, end=bytearray.byteLength*8) {
    let byteLen = Math.ceil((end-start)/8);
    let res = new Uint8Array(byteLen);
    let startByte = (start/8)>>0;
    let endByte = ((end/8)>>0) -1;
    let bitOffset = start%8;
    let nBitOffset = 8 - bitOffset;
    let endOffset = 8 - end%8;
    for (let i=0; i<byteLen; ++i) {
        let tail = 0;
        if (i<endByte) {
            tail = bytearray[startByte+i+1] >> nBitOffset;
            if (i == endByte-1 && endOffset < 8) {
                tail >>= endOffset;
                tail <<= endOffset;
            }
        }
        res[i]=(bytearray[startByte+i]<<bitOffset) | tail;
    }
    return res;
}
class BitArray {

    constructor(src) {
        this.src    = new DataView(src.buffer, src.byteOffset);
        this.bitpos = 0;
        this.byte   = 0; /* This should really be undefined, uint wont allow it though */
        this.bytepos = 0;
    }

    readBits(length) {
        if (32 < (length|0) || 0 === (length|0)) {
            /* To big for an uint */
            throw new Error("too big");
        }

        let result = 0;
        this.byte = this.src.getUint8(this.bytepos);
        for (let i = 1; i <= length; ++i) {

            /* Shift result one left to make room for another bit,
             then add the next bit on the stream. */
            result = ((result|0) << 1) | (((this.byte|0) >> (8 - (++this.bitpos))) & 0x01);
            if ((this.bitpos|0)>=8) {
                this.byte = this.src.getUint8(++this.bytepos);
            }
            this.bitpos %= 8;
        }

        return result;
    }
    skipBits(length) {
        this.bitpos += (length|0) % 8;
        this.bytepos += ((length|0) / 8)>>0;
        this.byte = this.src.getUint8(this.bytepos);
    }
}
class ExpGolomb {

  constructor(data) {
    this.data = data;
    // the number of bytes left to examine in this.data
    this.bytesAvailable = this.data.byteLength;
    // the current word being examined
    this.word = 0; // :uint
    // the number of bits left to examine in the current word
    this.bitsAvailable = 0; // :uint
  }

  // ():void
  loadWord() {
    var
      position = this.data.byteLength - this.bytesAvailable,
      workingBytes = new Uint8Array(4),
      availableBytes = Math.min(4, this.bytesAvailable);
    if (availableBytes === 0) {
      throw new Error('no bytes available');
    }
    workingBytes.set(this.data.subarray(position, position + availableBytes));
    this.word = new DataView(workingBytes.buffer, workingBytes.byteOffset).getUint32(0);
    // track the amount of this.data that has been processed
    this.bitsAvailable = availableBytes * 8;
    this.bytesAvailable -= availableBytes;
  }

  // (count:int):void
  skipBits(count) {
    var skipBytes; // :int
    if (this.bitsAvailable > count) {
      this.word <<= count;
      this.bitsAvailable -= count;
    } else {
      count -= this.bitsAvailable;
      skipBytes = count >> 3;
      count -= (skipBytes >> 3);
      this.bytesAvailable -= skipBytes;
      this.loadWord();
      this.word <<= count;
      this.bitsAvailable -= count;
    }
  }

  // (size:int):uint
  readBits(size) {
    var
      bits = Math.min(this.bitsAvailable, size), // :uint
      valu = this.word >>> (32 - bits); // :uint
    if (size > 32) {
      logger.error('Cannot read more than 32 bits at a time');
    }
    this.bitsAvailable -= bits;
    if (this.bitsAvailable > 0) {
      this.word <<= bits;
    } else if (this.bytesAvailable > 0) {
      this.loadWord();
    }
    bits = size - bits;
    if (bits > 0) {
      return valu << bits | this.readBits(bits);
    } else {
      return valu;
    }
  }

  // ():uint
  skipLZ() {
    var leadingZeroCount; // :uint
    for (leadingZeroCount = 0; leadingZeroCount < this.bitsAvailable; ++leadingZeroCount) {
      if (0 !== (this.word & (0x80000000 >>> leadingZeroCount))) {
        // the first bit of working word is 1
        this.word <<= leadingZeroCount;
        this.bitsAvailable -= leadingZeroCount;
        return leadingZeroCount;
      }
    }
    // we exhausted word and still have not found a 1
    this.loadWord();
    return leadingZeroCount + this.skipLZ();
  }

  // ():void
  skipUEG() {
    this.skipBits(1 + this.skipLZ());
  }

  // ():void
  skipEG() {
    this.skipBits(1 + this.skipLZ());
  }

  // ():uint
  readUEG() {
    var clz = this.skipLZ(); // :uint
    return this.readBits(clz + 1) - 1;
  }

  // ():int
  readEG() {
    var valu = this.readUEG(); // :int
    if (0x01 & valu) {
      // the number is odd if the low order bit is set
      return (1 + valu) >>> 1; // add 1 to make it even, and divide by 2
    } else {
      return -1 * (valu >>> 1); // divide by two then make it negative
    }
  }

  // Some convenience functions
  // :Boolean
  readBoolean() {
    return 1 === this.readBits(1);
  }

  // ():int
  readUByte() {
    return this.readBits(8);
  }

  // ():int
  readUShort() {
    return this.readBits(16);
  }
    // ():int
  readUInt() {
    return this.readBits(32);
  }

  /**
   * Advance the ExpGolomb decoder past a scaling list. The scaling
   * list is optionally transmitted as part of a sequence parameter
   * set and is not relevant to transmuxing.
   * @param count {number} the number of entries in this scaling list
   * @see Recommendation ITU-T H.264, Section 7.3.2.1.1.1
   */
  skipScalingList(count) {
    var
      lastScale = 8,
      nextScale = 8,
      j,
      deltaScale;
    for (j = 0; j < count; j++) {
      if (nextScale !== 0) {
        deltaScale = this.readEG();
        nextScale = (lastScale + deltaScale + 256) % 256;
      }
      lastScale = (nextScale === 0) ? lastScale : nextScale;
    }
  }

  /**
   * Read a sequence parameter set and return some interesting video
   * properties. A sequence parameter set is the H264 metadata that
   * describes the properties of upcoming video frames.
   * @param data {Uint8Array} the bytes of a sequence parameter set
   * @return {object} an object with configuration parsed from the
   * sequence parameter set, including the dimensions of the
   * associated video frames.
   */
  readSPS() {
    var
      frameCropLeftOffset = 0,
      frameCropRightOffset = 0,
      frameCropTopOffset = 0,
      frameCropBottomOffset = 0,
      sarScale = 1,
      profileIdc,profileCompat,levelIdc,
      numRefFramesInPicOrderCntCycle, picWidthInMbsMinus1,
      picHeightInMapUnitsMinus1,
      frameMbsOnlyFlag,
      scalingListCount,
      i;
    this.readUByte();
    profileIdc = this.readUByte(); // profile_idc
    profileCompat = this.readBits(5); // constraint_set[0-4]_flag, u(5)
    this.skipBits(3); // reserved_zero_3bits u(3),
    levelIdc = this.readUByte(); //level_idc u(8)
    this.skipUEG(); // seq_parameter_set_id
    // some profiles have more optional data we don't need
    if (profileIdc === 100 ||
        profileIdc === 110 ||
        profileIdc === 122 ||
        profileIdc === 244 ||
        profileIdc === 44  ||
        profileIdc === 83  ||
        profileIdc === 86  ||
        profileIdc === 118 ||
        profileIdc === 128) {
      var chromaFormatIdc = this.readUEG();
      if (chromaFormatIdc === 3) {
        this.skipBits(1); // separate_colour_plane_flag
      }
      this.skipUEG(); // bit_depth_luma_minus8
      this.skipUEG(); // bit_depth_chroma_minus8
      this.skipBits(1); // qpprime_y_zero_transform_bypass_flag
      if (this.readBoolean()) { // seq_scaling_matrix_present_flag
        scalingListCount = (chromaFormatIdc !== 3) ? 8 : 12;
        for (i = 0; i < scalingListCount; i++) {
          if (this.readBoolean()) { // seq_scaling_list_present_flag[ i ]
            if (i < 6) {
              this.skipScalingList(16);
            } else {
              this.skipScalingList(64);
            }
          }
        }
      }
    }
    this.skipUEG(); // log2_max_frame_num_minus4
    var picOrderCntType = this.readUEG();
    if (picOrderCntType === 0) {
      this.readUEG(); //log2_max_pic_order_cnt_lsb_minus4
    } else if (picOrderCntType === 1) {
      this.skipBits(1); // delta_pic_order_always_zero_flag
      this.skipEG(); // offset_for_non_ref_pic
      this.skipEG(); // offset_for_top_to_bottom_field
      numRefFramesInPicOrderCntCycle = this.readUEG();
      for(i = 0; i < numRefFramesInPicOrderCntCycle; i++) {
        this.skipEG(); // offset_for_ref_frame[ i ]
      }
    }
    this.skipUEG(); // max_num_ref_frames
    this.skipBits(1); // gaps_in_frame_num_value_allowed_flag
    picWidthInMbsMinus1 = this.readUEG();
    picHeightInMapUnitsMinus1 = this.readUEG();
    frameMbsOnlyFlag = this.readBits(1);
    if (frameMbsOnlyFlag === 0) {
      this.skipBits(1); // mb_adaptive_frame_field_flag
    }
    this.skipBits(1); // direct_8x8_inference_flag
    if (this.readBoolean()) { // frame_cropping_flag
      frameCropLeftOffset = this.readUEG();
      frameCropRightOffset = this.readUEG();
      frameCropTopOffset = this.readUEG();
      frameCropBottomOffset = this.readUEG();
    }
    if (this.readBoolean()) {
      // vui_parameters_present_flag
      if (this.readBoolean()) {
        // aspect_ratio_info_present_flag
        let sarRatio;
        const aspectRatioIdc = this.readUByte();
        switch (aspectRatioIdc) {
          case 1: sarRatio = [1,1]; break;
          case 2: sarRatio = [12,11]; break;
          case 3: sarRatio = [10,11]; break;
          case 4: sarRatio = [16,11]; break;
          case 5: sarRatio = [40,33]; break;
          case 6: sarRatio = [24,11]; break;
          case 7: sarRatio = [20,11]; break;
          case 8: sarRatio = [32,11]; break;
          case 9: sarRatio = [80,33]; break;
          case 10: sarRatio = [18,11]; break;
          case 11: sarRatio = [15,11]; break;
          case 12: sarRatio = [64,33]; break;
          case 13: sarRatio = [160,99]; break;
          case 14: sarRatio = [4,3]; break;
          case 15: sarRatio = [3,2]; break;
          case 16: sarRatio = [2,1]; break;
          case 255: {
            sarRatio = [this.readUByte() << 8 | this.readUByte(), this.readUByte() << 8 | this.readUByte()];
            break;
          }
        }
        if (sarRatio) {
          sarScale = sarRatio[0] / sarRatio[1];
        }
      }
    }
    return {
      width: Math.ceil((((picWidthInMbsMinus1 + 1) * 16) - frameCropLeftOffset * 2 - frameCropRightOffset * 2) * sarScale),
      height: ((2 - frameMbsOnlyFlag) * (picHeightInMapUnitsMinus1 + 1) * 16) - ((frameMbsOnlyFlag? 2 : 4) * (frameCropTopOffset + frameCropBottomOffset))
    };
  }

  readSliceType() {
    // skip NALu type
    this.readUByte();
    // discard first_mb_in_slice
    this.readUEG();
    // return slice_type
    return this.readUEG();
  }
}

class MSE {
    static get ErrorNotes() {return  {
      [MediaError.MEDIA_ERR_ABORTED]: 'fetching process aborted by user',
      [MediaError.MEDIA_ERR_NETWORK]: 'error occurred when downloading',
      [MediaError.MEDIA_ERR_DECODE]: 'error occurred when decoding',
      [MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED]: 'audio/video not supported'
    }};
    static isSupported(codecs=[MSE.CODEC_AVC_BASELINE, MSE.CODEC_AAC]) {
        return (window.MediaSource && window.MediaSource.isTypeSupported(`video/mp4; codecs="${codecs.join(',')}"`));
    }
    constructor (players) {
        this.players = players;
        this.eventSource = new EventEmitter();
        this.reset();
    }
    destroy() {
          this.clear();
          this.eventSource.destroy();
    }
    play() {
         this.players.forEach((video)=>{video.play();});
    }
    resetBuffers() {
          this.players.forEach((video)=>{
              video.pause();
              video.currentTime=0;
          });

          let promises = [];
          for (let buffer of this.buffers.values()) {
              promises.push(buffer.clear());
          }
          return Promise.all(promises).then(()=>{
              this.mediaSource.endOfStream();
              this.mediaSource.duration = 0;
              this.mediaSource.clearLiveSeekableRange();
              this.play();
          });
    }
    clear() {
      for (let track in this.buffers) {
        this.buffers[track].destroy();
        delete this.buffers[track];
      }
    }
    doCleanup(){
      for (let track in this.buffers) {
        this.buffers[track].doCleanup();

      }
    }
    reset() {
        this.updating = false;
        this.resolved = false;
        this.buffers = {};
        this.mediaSource = new MediaSource();
        this.players.forEach((video)=>{video.src = URL.createObjectURL(this.mediaSource)});
        // TODO: remove event listeners for existing media source
        this.mediaReady = new Promise((resolve, reject)=>{
            this.mediaSource.addEventListener('sourceopen', ()=>{
                console.log(`Media source opened: ${this.mediaSource.readyState}`);
                if (!this.resolved) {
                    this.resolved = true;
                    resolve();
                }
            });
            this.mediaSource.addEventListener('sourceended', ()=>{
                console.log(`Media source ended: ${this.mediaSource.readyState}`);
            });
            this.mediaSource.addEventListener('sourceclose', ()=>{
                console.log(`Media source closed: ${this.mediaSource.readyState}`);
                this.eventSource.dispatchEvent('sourceclose');
            });
        });
    }
    setCodec(track,mimeCodec) {
      return this.mediaReady.then(()=>{
            this.buffers[track] = new Buffer(this, mimeCodec);
      });
    }
    feed(track,data) {
      if (this.buffers[track]) {
        this.buffers[track].feed(data);
      }
    }
}
const listener = Symbol("event_listener");
const listeners = Symbol("event_listeners");
class Remuxer {
    static get TrackConverters() {return {
          'H264': H264TrackConverter,
          //'MP4A-LATM':  AACTrackConverter
      }};
    constructor() {
       // this.eventSource = new EventEmitter();

        this.initialized = false;
        this.initSegment = null;
        this.tracks = {};
        this.codecs = [];
        this.streams = {};
        this.enabled = false;
        this.mse_ready = true;
        //Khai báo sự kiện khi MSE bị sự cố, sẽ clear lại data
        this.errorListener = this.sendTeardown.bind(this);
        this.closeListener = this.sendTeardown.bind(this);
        this.count=0;
        this.track_type=null;
    }

    setTrack(track, stream) {
        let fmt = track.rtpmap[track.fmt[0]].name;
        this.streams[track.type] = stream;
        if (Remuxer.TrackConverters[fmt]){
            this.tracks[track.type] = new Remuxer.TrackConverters[fmt](track);
        } else {
            Log.warn(`${track.type} track is not attached cause there is no remuxer for ${fmt}`);
        }
    }

    setTimeOffset(timeOffset, track) {
        if (this.tracks[track.type]) {
            this.tracks[track.type].timeOffset = timeOffset/this.tracks[track.type].scaleFactor;
        }
    }

    init() {
        let tracks = [];
        let initmse = [];
        this.codecs = [];
        for (let track_type in this.tracks) {
            let track = this.tracks[track_type];
            if (!MSE.isSupported([track.codecstring])) {
                throw new Error(`${track.mp4track.type} codec ${track.codecstring} is not supported`);
            }
            tracks.push(track.mp4track);
            this.codecs.push(track.codecstring);
            initmse.push(this.initMSE(track_type, track.mp4track.codec));
            this.track_type=track_type;
            this.initSegment = MP4.initSegment(tracks, 90000, 90000);
        }
        this.initialized = true;
        Promise.all(initmse).then(()=>{
            this.mse.play();
            this.enabled = true;
        });

    }

    initMSE(track_type) {
        if (MSE.isSupported(this.codecs)) {
            //Khai báo Codecs cho MSE
            return this.mse.setCodec(track_type,`video/mp4; codecs="${this.codecs.join(', ')}"`).then(()=>{
                this.mse.feed(track_type, this.initSegment);
            });
        } else {
            throw new Error('Codecs are not supported');
            Log('Codec không hỗ trợ','error');
        }
    }

    attachMSE(mse) {
        if (this.mse) {
            this.detachMSE()
        }
        this.mse = mse;
        this.mse.eventSource.addEventListener('error', this.errorListener);
        this.mse.eventSource.addEventListener('sourceclose', this.closeListener);
        if (this.initialized) {
            this.initMSE();
        }
    }

    detachMSE() {
        if (this.mse) {
            this.mse.eventSource.removeEventListener('error', this.errorListener);
            this.mse.eventSource.removeEventListener('sourceclose', this.closeListener);
            this.mse = null;
        }
    }

    sendTeardown() {
        // Clear hết tất cả dữ liệu và thực hiện kết nối khởi tạo lại
        Log('Xóa hết cache','info');
        this.mse_ready = false;
        this.enabled = false;
        this.initialized = false;
        //this.mse.clear();

        /*
            Doan nay bat them su ly de disconnect socket
        */

    }
    flush() {
        if (!this.mse_ready) return;
        if (!this.initialized) {
            for (let track_type in this.tracks) {
                //Nếu chưa sẵn sàng decode thì return không làm gì cả
                if (!this.tracks[track_type].readyToDecode) return;
            }
            try {
                //Bắt đầu khởi tạo MSE và decode
                Log('Khởi tạo player thành công, sẵn sàng decode  ','info');
                this.init();
            } catch (e) {
                this.eventSource.dispatchEvent('error', {'reason': e.message});
                 Log('Có lỗi trong quá trình khởi tạo player'+e.message,'error');
                Log.error(e.message);
                this.sendTeardown();
                return;
            }
        }
        if (!this.enabled) return;
        if (this.mse ) {
            for (let track_type in this.tracks) {
                let track = this.tracks[track_type];
                let pay = track.getPayload();
                if (pay && pay.byteLength) {
                    //Bóc tách được ra thành các nal đưa vào đóng gói thành MP4
                    let mdat = MP4.mdat(pay);
                    let moof = MP4.moof(track.seq, track.firstDTS, track.mp4track);
                    //sau khi convert thành công đưa vào MSE để chạy
                    this.mse.feed(track_type,moof);
                    this.mse.feed(track_type,mdat);
                    track.flush();
                }
            }
        } else {
            for (let track_type in this.tracks) {
                let track = this.tracks[track_type];
                track.flush();
            }
        }
    }
    feedRTP(rtpPacket) {
        //Bắt đầu bóc tách RTP
        let track = this.tracks[rtpPacket.media.type];
        if (track) {
            track.remux(rtpPacket);
        }
    }
}
class DestructibleEventListener {
      constructor(eventListener) {
          this[listener] = eventListener;
          this[listeners] = new Map();
      }

      destroy() {
          this[listeners].forEach((listener_set, event)=>{
              listener_set.forEach((fn)=>{
                  this[listener].removeEventListener(event, fn);
              });
              listener_set = null;
          });
          this[listeners] = null;
      }

      addEventListener(event, fn) {
          if (!this[listeners].has(event)) {
              this[listeners].set(event, new Set());
          }
          this[listeners].get(event).add(fn);
          this[listener].addEventListener(event, fn, false);
      }

      removeEventListener(event, fn) {
          this[listener].removeEventListener(event, fn, false);
          if (this[listeners].has(event)) {
              this[listeners].set(event, new Set());
              let ev = this[listeners].get(event);
              ev.delete(fn);
              if (!ev.size) {
                  this[listeners].delete(event);
              }
          }
      }

      dispatchEvent(event) {
          this[listener].dispatchEvent(event);
      }
}
class EventEmitter {
      constructor() {
          this[listener] = new DestructibleEventListener(document.createElement('div'));
      }

      destroy() {
          this[listener].destroy();
          this[listener] = null;
      }

      addEventListener(event, fn) {
          this[listener].addEventListener(event, fn, false);
      }

      removeEventListener(event, fn) {
          this[listener].removeEventListener(event, fn, false);
      }

      dispatchEvent(event, data) {
          this[listener].dispatchEvent(new CustomEvent(event, {detail: data}))
      }
}
class Buffer {
      constructor(parent, codec) {
          this.mediaSource = parent.mediaSource;
          this.players = parent.players;
          this.cleaning = false;
          this.parent = parent;
          this.queue = [];
          this.cleanResolvers = [];
          this.codec = codec;
          this.check=false;
          this.flushBuffer = false;
          this.bufferFlushInterval = setInterval(()=>{
              this.flushBuffer = true;
          }, 50000);
          //codec = codec.replace('4d001e','4d001f');
          console.log(`Use codec: ${codec}`);

          this.sourceBuffer = this.mediaSource.addSourceBuffer(codec);
          this.sourceBuffer.mode='sequence';
          console.log('SourceBuffer mode set to ' + this.sourceBuffer.mode);
          this.sourceBuffer.addEventListener('updatestart', (e)=> {
              if (this.cleaning) {
                  console.log(`${this.codec} cleaning start`);
              }
          });

          this.sourceBuffer.addEventListener('update', (e)=> {
              // this.updating = true;
              if (this.cleaning) {
                  console.log(`${this.codec} cleaning update`);
              }
          });

          this.sourceBuffer.addEventListener('updateend', (e)=> {
              if (this.cleaning) {
                  console.log(`${this.codec} cleaning end`);
                  /*if (this.sourceBuffer.buffered.length && this.players[0].currentTime < this.sourceBuffer.buffered.start(0)) {
                    this.players[0].currentTime = this.sourceBuffer.buffered.start(0);
                  }*/
                  while (this.cleanResolvers.length) {
                      let resolver = this.cleanResolvers.shift();
                      resolver();
                  }
                  this.cleaning = false;
              } else {
                  // Log.debug(`buffered: ${this.sourceBuffer.buffered.end(0)}, current ${this.players[0].currentTime}`);
              }

              let buff_len = this.sourceBuffer.buffered.length;
              if (this.flushBuffer && !this.sourceBuffer.updating &&  buff_len>0 && this.mediaSource.duration){
                  console.log('BUFFER FLUSHING....');
                  let i = 0;
                  for (;i<this.sourceBuffer.buffered.length-1;i++)
                      {
                          if (!this.sourceBuffer.updating&&this.sourceBuffer.buffered.end(i)-this.sourceBuffer.buffered.start(i) > 0.5)
                              this.sourceBuffer.remove(this.sourceBuffer.buffered.start(i),this.sourceBuffer.buffered.end(i));
                      }
                  if (!this.sourceBuffer.updating){
                        if (this.sourceBuffer.buffered.end(this.sourceBuffer.buffered.length-1)-this.sourceBuffer.buffered.start(this.sourceBuffer.buffered.length-1) > 10)
                            this.sourceBuffer.remove(this.sourceBuffer.buffered.start(this.sourceBuffer.buffered.length-1),this.sourceBuffer.buffered.end(this.sourceBuffer.buffered.length-1) - 5);
                        this.flushBuffer = false;
                  }
              }


    //          console.log('Buffer length:'+ this.sourceBuffer.buffered.length+' buffered:' + ' duration = '+this.mediaSource.duration);
              this.feedNext();
          });

          this.sourceBuffer.addEventListener('error', (e)=> {
              console.log(`Source buffer error: ${this.mediaSource.readyState}`);
              if (this.mediaSource.sourceBuffers.length) {
                  this.mediaSource.removeSourceBuffer(this.sourceBuffer);
              }
              this.parent.eventSource.dispatchEvent('error');
          });

          this.sourceBuffer.addEventListener('abort', (e)=> {
              console.log(`Source buffer aborted: ${this.mediaSource.readyState}`);
              if (this.mediaSource.sourceBuffers.length) {
                  this.mediaSource.removeSourceBuffer(this.sourceBuffer);
              }
              this.parent.eventSource.dispatchEvent('error');
          });

          if (!this.sourceBuffer.updating) {
              this.feedNext();
          }

          // TODO: cleanup every hour for live streams
      }

      destroy() {
          clearInterval(this.bufferFlushInterval);
          this.clear();
          this.mediaSource.removeSourceBuffer(this.sourceBuffer);
      }

      clear() {
          this.queue = [];
          let promises = [];
          for (let i=0; i< this.sourceBuffer.buffered.length; ++i) {
              // TODO: await remove
              this.cleaning = true;
              promises.push(new Promise((resolve, reject)=>{
                  this.cleanResolvers.push(resolve);
                  //this.sourceBuffer.remove(this.sourceBuffer.buffered.start(i), this.sourceBuffer.buffered.end(i));
              }));
          }
          return Promise.all(promises);
      }

      feedNext() {

          if (!this.sourceBuffer.updating && !this.cleaning && this.queue.length) {
            if (this.sourceBuffer.buffered.length &&  this.sourceBuffer.buffered.end(this.sourceBuffer.buffered.length-1)-this.sourceBuffer.buffered.start(this.sourceBuffer.buffered.length-1)>5) {
             // let time_deference = this.players[0].duration-this.players[0].currentTime;
             let time_deference = this.sourceBuffer.buffered.end(this.sourceBuffer.buffered.length-1)-this.players[0].currentTime;

             if (time_deference>1) {
               Log('Độ trễ >1s, đồng bộ lại dữ liệu','warning');
               //console.log(this.players[0].duration+'-'+this.players[0].currentTime+"="+time_deference);
               //this.players[0].currentTime = this.sourceBuffer.buffered.end(this.sourceBuffer.buffered.length-1)-0.5;
               this.players[0].playbackRate = 1.5;
               console.log('speed 1.5');
             }

              if (time_deference<0.5 &&this.players[0].playbackRate>1){
                   this.players[0].playbackRate = 1;
                   console.log('speed 1');
            //    lb_delay.text(Math.abs(time_deference)+'s');
              }
            }
        //    this.queue.shift();
           if (!this.sourceBuffer.updating)
            this.doAppend(this.queue.shift());
          }
      }

      doCleanup() {

          if (this.sourceBuffer.buffered.length && !this.sourceBuffer.updating && !this.cleaning) {
            /*
              console.log(`${this.codec} cleanup`);
              let bufferStart = this.sourceBuffer.buffered.start(0);
              let removeEnd = this.sourceBuffer.buffered.start(0) + (this.sourceBuffer.buffered.end(0) - this.sourceBuffer.buffered.start(0))/2;
              if (this.players[0].currentTime < removeEnd) {
                  this.players[0].currentTime = removeEnd;
              }
              if (removeEnd > bufferStart && (removeEnd - bufferStart > 0.5 )) {
                      console.log(`${this.codec} remove range [${bufferStart} - ${removeEnd}).
                    \nBuffered end: ${this.sourceBuffer.buffered.end(0)}
                    \nUpdating: ${this.sourceBuffer.updating}
                    `);
                      this.cleaning = true;
                      this.sourceBuffer.remove(bufferStart, removeEnd);
              } else {
                  this.feedNext();
              }
              */
          } else {if (!this.sourceBuffer.updating)

              this.feedNext();
          }
      }

      doAppend(data) {
          let err = this.players[0].error;
          if (err) {           if (!this.sourceBuffer.updating)

              console.log(`Error occured: ${MSE.ErrorNotes[err.code]}`);
              Log(`Có lỗi trong quá trình giải mã: ${MSE.ErrorNotes[err.code]}`,'error');
              try {
                  this.mediaSource.endOfStream();
                  //this.players.forEach((video)=>{video.stop();});

              } catch (e){

              }
              this.parent.eventSource.dispatchEvent('error');
          } else {
              try {
              //    this.updating = true;
                  if (!this.sourceBuffer.updating) // QuanVA: 3rd fix: never append when updating is true
                      this.sourceBuffer.appendBuffer(data);
              } catch (e) {
                  if (e.name === 'QuotaExceededError') {
                      console.log(`${this.codec} quota fail`);
                      // do not unshift
                    //  this.queue.unshift(data);
                      this.doCleanup();
                      return;
                  }
                  // reconnect on fail
                  console.log(`Error occured while appending buffer. ${e.name}: ${e.message}`);
                  Log(`Dữ liệu decode không thể play: ${e.name}: ${e.message}`,'error');
                  this.parent.eventSource.dispatchEvent('error');
              }
          }

      }

      feed(data) {
          if (this.queue.length>100)
              this.queue.shift();
          this.queue = this.queue.concat(data);

          if (this.sourceBuffer && !this.sourceBuffer.updating) {
              this.feedNext();
          }
      }
}
class SDPParser {
    constructor(){
        this.version = -1;
        this.origin = null;
        this.sessionName = null;
        this.timing = null;
        this.sessionBlock = {};
        this.media = {};
        this.tracks = {};
        this.mediaMap = {};
    }
    parse(content) {
        return new Promise((resolve, reject)=>{
            var dataString = content;
            var success = true;
            var currentMediaBlock = this.sessionBlock;

            // TODO: multiple audio/video tracks

            for (let line of dataString.split("\n")) {
                line = line.replace(/\r/, '');
                if (0 === line.length) {
                    /* Empty row (last row perhaps?), skip to next */
                    continue;
                }

                switch (line.charAt(0)) {
                    case 'v':
                        if (-1 !== this.version) {
                            console.log('Version present multiple times in SDP');
                            reject();
                            return false;
                        }
                        success = success && this._parseVersion(line);
                        break;

                    case 'o':
                        if (null !== this.origin) {
                            console.log('Origin present multiple times in SDP');
                            reject();
                            return false;
                        }
                        success = success && this._parseOrigin(line);
                        break;

                    case 's':
                        if (null !== this.sessionName) {
                            console.log('Session Name present multiple times in SDP');
                            reject();
                            return false;
                        }
                        line='s=mychn';
                        success = success && this._parseSessionName(line);
                        break;

                    case 't':
                        if (null !== this.timing) {
                            console.log('Timing present multiple times in SDP');
                            reject();
                            return false;
                        }
                        success = success && this._parseTiming(line);
                        break;

                    case 'm':
                        if (null !== currentMediaBlock && this.sessionBlock !== currentMediaBlock) {
                            /* Complete previous block and store it */
                            this.media[currentMediaBlock.type] = currentMediaBlock;
                        }

                        /* A wild media block appears */
                        currentMediaBlock = {};
                        currentMediaBlock.rtpmap = {};
                        this._parseMediaDescription(line, currentMediaBlock);
                        break;

                    case 'a':
                        if (line=='a=rtpmap:96 H264/90000 ') {
                          console.log('a=rtpmap:96 H264/90000 ');
                        }
                        SDPParser._parseAttribute(line, currentMediaBlock);
                        break;

                    default:
                        console.log('Ignored unknown SDP directive: ' + line);
                        break;
                }

                if (!success) {
                    reject();
                    return;
                }
            }

            this.media[currentMediaBlock.type] = currentMediaBlock;

            success?resolve():reject();
        });
    }
    _parseVersion(line) {
        var matches = line.match(/^v=([0-9]+)$/);
        if (0 === matches.length) {
            console.log('\'v=\' (Version) formatted incorrectly: ' + line);
            return false;
        }

        this.version = matches[1];
        if (0 != this.version) {
            console.log('Unsupported SDP version:' + this.version);
            return false;
        }

        return true;
    }
    _parseOrigin(line) {
        var matches = line.match(/^o=([^ ]+) ([0-9]+) ([0-9]+) (IN) (IP4|IP6) ([^ ]+)$/);
        if (0 === matches.length) {
            console.log('\'o=\' (Origin) formatted incorrectly: ' + line);
            return false;
        }
        this.origin = {};
        this.origin.username       = matches[1];
        this.origin.sessionid      = matches[2];
        this.origin.sessionversion = matches[3];
        this.origin.nettype        = matches[4];
        this.origin.addresstype    = matches[5];
        this.origin.unicastaddress = matches[6];
        return true;
    }
    _parseSessionName(line) {
        var matches = line.match(/^s=([^\r\n]+)$/);
        if (0 === matches.length) {
            console.log('\'s=\' (Session Name) formatted incorrectly: ' + line);
            return false;
        }

        this.sessionName = matches[1];

        return true;
    }
    _parseTiming(line) {
        var matches = line.match(/^t=([0-9]+) ([0-9]+)$/);
        if (0 === matches.length) {
            console.log('\'t=\' (Timing) formatted incorrectly: ' + line);
            return false;
        }

        this.timing = {};
        this.timing.start = matches[1];
        this.timing.stop  = matches[2];

        return true;
    }
    _parseMediaDescription(line, media) {
        var matches = line.match(/^m=([^ ]+) ([^ ]+) ([^ ]+)[ ]/);
        if (0 === matches.length) {
            console.log('\'m=\' (Media) formatted incorrectly: ' + line);
            return false;
        }

        media.type  = matches[1];
        media.port  = matches[2];
        media.proto = matches[3];
        media.fmt   = line.substr(matches[0].length).split(' ').map(function(fmt, index, array) {
            return parseInt(fmt);
        });

        for (let fmt of media.fmt) {
            this.mediaMap[fmt] = media;
        }

        return true;
    }
    static _parseAttribute(line, media) {
        if (null === media) {
            /* Not in a media block, can't be bothered parsing attributes for session */
            return true;
        }

        var matches; /* Used for some cases of below switch-case */
        var separator = line.indexOf(':');
        var attribute = line.substr(0, (-1 === separator) ? 0x7FFFFFFF : separator); /* 0x7FF.. is default */

        switch (attribute) {
            case 'a=recvonly':
            case 'a=sendrecv':
            case 'a=sendonly':
            case 'a=inactive':
                media.mode = line.substr('a='.length);
                break;
            case 'a=range':
                matches = line.match(/^a=range:\s*([a-zA-Z-]+)=([0-9.]+|now)-([0-9.]*)$/);
                media.range= [Number(matches[2]=="now"?-1:matches[2]), Number(matches[3]), matches[1]];
                break;
            case 'a=control':
                media.control = line.substr('a=control:'.length);
                break;

            case 'a=rtpmap':
                matches = line.match(/^a=rtpmap:(\d+) (.*)$/);
                if (null === matches) {
                    console.log('Could not parse \'rtpmap\' of \'a=\'');
                    return false;
                }

                var payload = parseInt(matches[1]);
                media.rtpmap[payload] = {};

                var attrs = matches[2].split('/');
                media.rtpmap[payload].name  = attrs[0];
                media.rtpmap[payload].clock = attrs[1];
                if (undefined !== attrs[2]) {
                    media.rtpmap[payload].encparams = attrs[2];
                }
                //media.ptype = PayloadType.string_map[attrs[0]];

                break;

            case 'a=fmtp':
                matches = line.match(/^a=fmtp:(\d+) (.*)$/);
                if (0 === matches.length) {
                    console.log('Could not parse \'fmtp\'  of \'a=\'');
                    return false;
                }

                media.fmtp = {};
                for (var param of matches[2].split(';')) {
                    var idx = param.indexOf('=');
                    media.fmtp[param.substr(0, idx).toLowerCase().trim()] = param.substr(idx + 1).trim();
                }
                break;
        }

        return true;
    }
    getSessionBlock() {
        return this.sessionBlock;
    }
    hasMedia(mediaType) {
        return this.media[mediaType] != undefined;
    }
    getMediaBlock(mediaType) {
        return this.media[mediaType];
    }
    getMediaBlockByPayloadType(pt) {
        return this.mediaMap[pt] || null;
    }
    getMediaBlockList() {
        var res = [];
        for (var m in this.media) {
            res.push(m);
        }
        return res;
    }
}
class RTP {
      constructor(pkt/*uint8array*/, sdp) {
          let bytes = new DataView(pkt.buffer, pkt.byteOffset, pkt.byteLength);
          this.pt        = 96;
          this.timestamp64 = bytes.getFloat64(2);
          this.timestamp = Math.round((this.timestamp64>>32) + (this.timestamp64&0xffffffff)/Math.pow(2,32));
         //this.timestamp = this.timestamp64;
          this.csrcs     = [];
          let pktIndex=12;
          //let pktIndex=0;
          this.media = sdp.getMediaBlockByPayloadType(this.pt);

          this.data = pkt.subarray(pktIndex);
      }
      getPayload() {
          return this.data;
      }
      getTimestampMS() {
          return this.timestamp;
          //return 1000 * (this.timestamp / this.media.rtpmap[this.pt].clock);
      }
      toString() {
          return "RTP(" +
              "version:"   + this.version   + ", " +
              "padding:"   + this.padding   + ", " +
              "has_extension:" + this.has_extension + ", " +
              "csrc:"      + this.csrc      + ", " +
              "marker:"    + this.marker    + ", " +
              "pt:"        + this.pt        + ", " +
              "sequence:"  + this.sequence  + ", " +
              "timestamp:" + this.timestamp + ", " +
              "ssrc:"      + this.ssrc      + ")";
      }
      isVideo(){return this.media.type == 'video';}
      isAudio(){return this.media.type == 'audio';}
}
class MP4 {
    static init() {
        MP4.types = {
            avc1: [], // codingname
            avcC: [],
            btrt: [],
            dinf: [],
            dref: [],
            esds: [],
            ftyp: [],
            hdlr: [],
            mdat: [],
            mdhd: [],
            mdia: [],
            mfhd: [],
            minf: [],
            moof: [],
            moov: [],
            mp4a: [],
            mvex: [],
            mvhd: [],
            sdtp: [],
            stbl: [],
            stco: [],
            stsc: [],
            stsd: [],
            stsz: [],
            stts: [],
            tfdt: [],
            tfhd: [],
            traf: [],
            trak: [],
            trun: [],
            trex: [],
            tkhd: [],
            vmhd: [],
            smhd: []
        };

        var i;
        for (i in MP4.types) {
            if (MP4.types.hasOwnProperty(i)) {
                MP4.types[i] = [
                    i.charCodeAt(0),
                    i.charCodeAt(1),
                    i.charCodeAt(2),
                    i.charCodeAt(3)
                ];
            }
        }

        var videoHdlr = new Uint8Array([
            0x00, // version 0
            0x00, 0x00, 0x00, // flags
            0x00, 0x00, 0x00, 0x00, // pre_defined
            0x76, 0x69, 0x64, 0x65, // handler_type: 'vide'
            0x00, 0x00, 0x00, 0x00, // reserved
            0x00, 0x00, 0x00, 0x00, // reserved
            0x00, 0x00, 0x00, 0x00, // reserved
            0x56, 0x69, 0x64, 0x65,
            0x6f, 0x48, 0x61, 0x6e,
            0x64, 0x6c, 0x65, 0x72, 0x00 // name: 'VideoHandler'
        ]);

        var audioHdlr = new Uint8Array([
            0x00, // version 0
            0x00, 0x00, 0x00, // flags
            0x00, 0x00, 0x00, 0x00, // pre_defined
            0x73, 0x6f, 0x75, 0x6e, // handler_type: 'soun'
            0x00, 0x00, 0x00, 0x00, // reserved
            0x00, 0x00, 0x00, 0x00, // reserved
            0x00, 0x00, 0x00, 0x00, // reserved
            0x53, 0x6f, 0x75, 0x6e,
            0x64, 0x48, 0x61, 0x6e,
            0x64, 0x6c, 0x65, 0x72, 0x00 // name: 'SoundHandler'
        ]);

        MP4.HDLR_TYPES = {
            'video': videoHdlr,
            'audio': audioHdlr
        };

        var dref = new Uint8Array([
            0x00, // version 0
            0x00, 0x00, 0x00, // flags
            0x00, 0x00, 0x00, 0x01, // entry_count
            0x00, 0x00, 0x00, 0x0c, // entry_size
            0x75, 0x72, 0x6c, 0x20, // 'url' type
            0x00, // version 0
            0x00, 0x00, 0x01 // entry_flags
        ]);

        var stco = new Uint8Array([
            0x00, // version
            0x00, 0x00, 0x00, // flags
            0x00, 0x00, 0x00, 0x00 // entry_count
        ]);

        MP4.STTS = MP4.STSC = MP4.STCO = stco;

        MP4.STSZ = new Uint8Array([
            0x00, // version
            0x00, 0x00, 0x00, // flags
            0x00, 0x00, 0x00, 0x00, // sample_size
            0x00, 0x00, 0x00, 0x00, // sample_count
        ]);
        MP4.VMHD = new Uint8Array([
            0x00, // version
            0x00, 0x00, 0x01, // flags
            0x00, 0x00, // graphicsmode
            0x00, 0x00,
            0x00, 0x00,
            0x00, 0x00 // opcolor
        ]);
        MP4.SMHD = new Uint8Array([
            0x00, // version
            0x00, 0x00, 0x00, // flags
            0x00, 0x00, // balance
            0x00, 0x00 // reserved
        ]);

        MP4.STSD = new Uint8Array([
            0x00, // version 0
            0x00, 0x00, 0x00, // flags
            0x00, 0x00, 0x00, 0x01]);// entry_count

        var majorBrand = new Uint8Array([105,115,111,109]); // isom
        var avc1Brand = new Uint8Array([97,118,99,49]); // avc1
        var minorVersion = new Uint8Array([0, 0, 0, 1]);

        MP4.FTYP = MP4.box(MP4.types.ftyp, majorBrand, minorVersion, majorBrand, avc1Brand);
        MP4.DINF = MP4.box(MP4.types.dinf, MP4.box(MP4.types.dref, dref));
    }

    static box(type, ...payload) {
        var size = 8,
            i = payload.length,
            len = i,
            result;
        // calculate the total size we need to allocate
        while (i--) {
            size += payload[i].byteLength;
        }
        result = new Uint8Array(size);
        result[0] = (size >> 24) & 0xff;
        result[1] = (size >> 16) & 0xff;
        result[2] = (size >> 8) & 0xff;
        result[3] = size  & 0xff;
        result.set(type, 4);
        // copy the payload into the result
        for (i = 0, size = 8; i < len; ++i) {
            // copy payload[i] array @ offset size
            result.set(payload[i], size);
            size += payload[i].byteLength;
        }
        return result;
    }

    static hdlr(type) {
        return MP4.box(MP4.types.hdlr, MP4.HDLR_TYPES[type]);
    }

    static mdat(data) {
        return MP4.box(MP4.types.mdat, data);
    }

    static mdhd(timescale, duration) {
        return MP4.box(MP4.types.mdhd, new Uint8Array([
            0x00, // version 0
            0x00, 0x00, 0x00, // flags
            0x00, 0x00, 0x00, 0x02, // creation_time
            0x00, 0x00, 0x00, 0x03, // modification_time
            (timescale >> 24) & 0xFF,
            (timescale >> 16) & 0xFF,
            (timescale >>  8) & 0xFF,
            timescale & 0xFF, // timescale
            (duration >> 24),
            (duration >> 16) & 0xFF,
            (duration >>  8) & 0xFF,
            duration & 0xFF, // duration
            0x55, 0xc4, // 'und' language (undetermined)
            0x00, 0x00
        ]));
    }

    static mdia(track) {
        return MP4.box(MP4.types.mdia, MP4.mdhd(track.timescale, track.duration), MP4.hdlr(track.type), MP4.minf(track));
    }

    static mfhd(sequenceNumber) {
        return MP4.box(MP4.types.mfhd, new Uint8Array([
            0x00,
            0x00, 0x00, 0x00, // flags
            (sequenceNumber >> 24),
            (sequenceNumber >> 16) & 0xFF,
            (sequenceNumber >>  8) & 0xFF,
            sequenceNumber & 0xFF, // sequence_number
        ]));
    }

    static minf(track) {
        if (track.type === 'audio') {
            return MP4.box(MP4.types.minf, MP4.box(MP4.types.smhd, MP4.SMHD), MP4.DINF, MP4.stbl(track));
        } else {
            return MP4.box(MP4.types.minf, MP4.box(MP4.types.vmhd, MP4.VMHD), MP4.DINF, MP4.stbl(track));
        }
    }

    static moof(sn, baseMediaDecodeTime, track) {
        return MP4.box(MP4.types.moof, MP4.mfhd(sn), MP4.traf(track,baseMediaDecodeTime));
    }
    /**
     * @param tracks... (optional) {array} the tracks associated with this movie
     */
    static moov(tracks, duration, timescale) {
        var
            i = tracks.length,
            boxes = [];

        while (i--) {
            boxes[i] = MP4.trak(tracks[i]);
        }

        return MP4.box.apply(null, [MP4.types.moov, MP4.mvhd(timescale, duration)].concat(boxes).concat(MP4.mvex(tracks)));
    }

    static mvex(tracks) {
        var
            i = tracks.length,
            boxes = [];

        while (i--) {
            boxes[i] = MP4.trex(tracks[i]);
        }
        return MP4.box.apply(null, [MP4.types.mvex].concat(boxes));
    }

    static mvhd(timescale,duration) {
        var
            bytes = new Uint8Array([
                0x00, // version 0
                0x00, 0x00, 0x00, // flags
                0x00, 0x00, 0x00, 0x01, // creation_time
                0x00, 0x00, 0x00, 0x02, // modification_time
                (timescale >> 24) & 0xFF,
                (timescale >> 16) & 0xFF,
                (timescale >>  8) & 0xFF,
                timescale & 0xFF, // timescale
                (duration >> 24) & 0xFF,
                (duration >> 16) & 0xFF,
                (duration >>  8) & 0xFF,
                duration & 0xFF, // duration
                0x00, 0x01, 0x00, 0x00, // 1.0 rate
                0x01, 0x00, // 1.0 volume
                0x00, 0x00, // reserved
                0x00, 0x00, 0x00, 0x00, // reserved
                0x00, 0x00, 0x00, 0x00, // reserved
                0x00, 0x01, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x00,
                0x00, 0x01, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x00,
                0x40, 0x00, 0x00, 0x00, // transformation: unity matrix
                0x00, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x00, // pre_defined
                0xff, 0xff, 0xff, 0xff // next_track_ID
            ]);
        return MP4.box(MP4.types.mvhd, bytes);
    }

    static sdtp(track) {
        var
            samples = track.samples || [],
            bytes = new Uint8Array(4 + samples.length),
            flags,
            i;
        // leave the full box header (4 bytes) all zero
        // write the sample table
        for (i = 0; i < samples.length; i++) {
            flags = samples[i].flags;
            bytes[i + 4] = (flags.dependsOn << 4) |
                (flags.isDependedOn << 2) |
                (flags.hasRedundancy);
        }

        return MP4.box(MP4.types.sdtp, bytes);
    }

    static stbl(track) {
        return MP4.box(MP4.types.stbl, MP4.stsd(track), MP4.box(MP4.types.stts, MP4.STTS), MP4.box(MP4.types.stsc, MP4.STSC), MP4.box(MP4.types.stsz, MP4.STSZ), MP4.box(MP4.types.stco, MP4.STCO));
    }

    static avc1(track) {
        var sps = [], pps = [], i, data, len;
        // assemble the SPSs

        for (i = 0; i < track.sps.length; i++) {
            data = track.sps[i];
            len = data.byteLength;
            sps.push((len >>> 8) & 0xFF);
            sps.push((len & 0xFF));
            sps = sps.concat(Array.prototype.slice.call(data)); // SPS
        }

        // assemble the PPSs
        for (i = 0; i < track.pps.length; i++) {
            data = track.pps[i];
            len = data.byteLength;
            pps.push((len >>> 8) & 0xFF);
            pps.push((len & 0xFF));
            pps = pps.concat(Array.prototype.slice.call(data));
        }

        var avcc = MP4.box(MP4.types.avcC, new Uint8Array([
                0x01,   // version
                sps[3], // profile
                sps[4], // profile compat
                sps[5], // level
                0xfc | 3, // lengthSizeMinusOne, hard-coded to 4 bytes
                0xE0 | track.sps.length // 3bit reserved (111) + numOfSequenceParameterSets
            ].concat(sps).concat([
                track.pps.length // numOfPictureParameterSets
            ]).concat(pps))), // "PPS"
            width = track.width,
            height = track.height;
        //console.log('avcc:' + Hex.hexDump(avcc));
        return MP4.box(MP4.types.avc1, new Uint8Array([
                0x00, 0x00, 0x00, // reserved
                0x00, 0x00, 0x00, // reserved
                0x00, 0x01, // data_reference_index
                0x00, 0x00, // pre_defined
                0x00, 0x00, // reserved
                0x00, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x00, // pre_defined
                (width >> 8) & 0xFF,
                width & 0xff, // width
                (height >> 8) & 0xFF,
                height & 0xff, // height
                0x00, 0x48, 0x00, 0x00, // horizresolution
                0x00, 0x48, 0x00, 0x00, // vertresolution
                0x00, 0x00, 0x00, 0x00, // reserved
                0x00, 0x01, // frame_count
                0x12,
                0x62, 0x69, 0x6E, 0x65, //binelpro.ru
                0x6C, 0x70, 0x72, 0x6F,
                0x2E, 0x72, 0x75, 0x00,
                0x00, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x00, // compressorname
                0x00, 0x18,   // depth = 24
                0x11, 0x11]), // pre_defined = -1
            avcc,
            MP4.box(MP4.types.btrt, new Uint8Array([
                0x00, 0x1c, 0x9c, 0x80, // bufferSizeDB
                0x00, 0x2d, 0xc6, 0xc0, // maxBitrate
                0x00, 0x2d, 0xc6, 0xc0])) // avgBitrate
        );
    }

    static esds(track) {
        var configlen = track.config.byteLength;
        let data = new Uint8Array(26+configlen+3);
        data.set([
            0x00, // version 0
            0x00, 0x00, 0x00, // flags

            0x03, // descriptor_type
            0x17+configlen, // length
            0x00, 0x01, //es_id
            0x00, // stream_priority

            0x04, // descriptor_type
            0x0f+configlen, // length
            0x40, //codec : mpeg4_audio
            0x15, // stream_type
            0x00, 0x00, 0x00, // buffer_size
            0x00, 0x00, 0x00, 0x00, // maxBitrate
            0x00, 0x00, 0x00, 0x00, // avgBitrate

            0x05, // descriptor_type
            configlen
        ]);
        data.set(track.config, 26);
        data.set([0x06, 0x01, 0x02], 26+configlen);
        // return new Uint8Array([
        //     0x00, // version 0
        //     0x00, 0x00, 0x00, // flags
        //
        //     0x03, // descriptor_type
        //     0x17+configlen, // length
        //     0x00, 0x01, //es_id
        //     0x00, // stream_priority
        //
        //     0x04, // descriptor_type
        //     0x0f+configlen, // length
        //     0x40, //codec : mpeg4_audio
        //     0x15, // stream_type
        //     0x00, 0x00, 0x00, // buffer_size
        //     0x00, 0x00, 0x00, 0x00, // maxBitrate
        //     0x00, 0x00, 0x00, 0x00, // avgBitrate
        //
        //     0x05 // descriptor_type
        // ].concat([configlen]).concat(track.config).concat([0x06, 0x01, 0x02])); // GASpecificConfig)); // length + audio config descriptor
        return data;
    }

    static mp4a(track) {
        var audiosamplerate = track.audiosamplerate;
        return MP4.box(MP4.types.mp4a, new Uint8Array([
                0x00, 0x00, 0x00, // reserved
                0x00, 0x00, 0x00, // reserved
                0x00, 0x01, // data_reference_index
                0x00, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x00, // reserved
                0x00, track.channelCount, // channelcount
                0x00, 0x10, // sampleSize:16bits
                0x00, 0x00, // pre_defined
                0x00, 0x00, // reserved2
                (audiosamplerate >> 8) & 0xFF,
                audiosamplerate & 0xff, //
                0x00, 0x00]),
            MP4.box(MP4.types.esds, MP4.esds(track)));
    }

    static stsd(track) {
        if (track.type === 'audio') {
            return MP4.box(MP4.types.stsd, MP4.STSD, MP4.mp4a(track));
        } else {
            return MP4.box(MP4.types.stsd, MP4.STSD, MP4.avc1(track));
        }
    }

    static tkhd(track) {
        var id = track.id,
            duration = track.duration,
            width = track.width,
            height = track.height,
            volume = track.volume;
        return MP4.box(MP4.types.tkhd, new Uint8Array([
            0x00, // version 0
            0x00, 0x00, 0x07, // flags
            0x00, 0x00, 0x00, 0x00, // creation_time
            0x00, 0x00, 0x00, 0x00, // modification_time
            (id >> 24) & 0xFF,
            (id >> 16) & 0xFF,
            (id >> 8) & 0xFF,
            id & 0xFF, // track_ID
            0x00, 0x00, 0x00, 0x00, // reserved
            (duration >> 24),
            (duration >> 16) & 0xFF,
            (duration >>  8) & 0xFF,
            duration & 0xFF, // duration
            0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, // reserved
            0x00, 0x00, // layer
            0x00, 0x00, // alternate_group
            (volume>>0)&0xff, (((volume%1)*10)>>0)&0xff, // track volume // FIXME
            0x00, 0x00, // reserved
            0x00, 0x01, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00,
            0x00, 0x01, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00,
            0x40, 0x00, 0x00, 0x00, // transformation: unity matrix
            (width >> 8) & 0xFF,
            width & 0xFF,
            0x00, 0x00, // width
            (height >> 8) & 0xFF,
            height & 0xFF,
            0x00, 0x00 // height
        ]));
    }

    static traf(track,baseMediaDecodeTime) {
        var sampleDependencyTable = MP4.sdtp(track),
            id = track.id;
        return MP4.box(MP4.types.traf,
            MP4.box(MP4.types.tfhd, new Uint8Array([
                0x00, // version 0
                0x00, 0x00, 0x00, // flags
                (id >> 24),
                (id >> 16) & 0XFF,
                (id >> 8) & 0XFF,
                (id & 0xFF) // track_ID
            ])),
            MP4.box(MP4.types.tfdt, new Uint8Array([
                0x00, // version 0
                0x00, 0x00, 0x00, // flags
                (baseMediaDecodeTime >>24),
                (baseMediaDecodeTime >> 16) & 0XFF,
                (baseMediaDecodeTime >> 8) & 0XFF,
                (baseMediaDecodeTime & 0xFF) // baseMediaDecodeTime
            ])),
            MP4.trun(track,
                sampleDependencyTable.length +
                16 + // tfhd
                16 + // tfdt
                8 +  // traf header
                16 + // mfhd
                8 +  // moof header
                8),  // mdat header
            sampleDependencyTable);
    }

    /**
     * Generate a track box.
     * @param track {object} a track definition
     * @return {Uint8Array} the track box
     */
    static trak(track) {
        track.duration = track.duration || 0xffffffff;
        return MP4.box(MP4.types.trak, MP4.tkhd(track), MP4.mdia(track));
    }

    static trex(track) {
        var id = track.id;
        return MP4.box(MP4.types.trex, new Uint8Array([
            0x00, // version 0
            0x00, 0x00, 0x00, // flags
            (id >> 24),
            (id >> 16) & 0XFF,
            (id >> 8) & 0XFF,
            (id & 0xFF), // track_ID
            0x00, 0x00, 0x00, 0x01, // default_sample_description_index
            0x00, 0x00, 0x00, 0x00, // default_sample_duration
            0x00, 0x00, 0x00, 0x00, // default_sample_size
            0x00, 0x01, 0x00, 0x01 // default_sample_flags
        ]));
    }

    static trun(track, offset) {
        var samples= track.samples || [],
            len = samples.length,
            arraylen = 12 + (16 * len),
            array = new Uint8Array(arraylen),
            i,sample,duration,size,flags,cts;
        offset += 8 + arraylen;
        array.set([
            0x00, // version 0
            0x00, 0x0f, 0x01, // flags
            (len >>> 24) & 0xFF,
            (len >>> 16) & 0xFF,
            (len >>> 8) & 0xFF,
            len & 0xFF, // sample_count
            (offset >>> 24) & 0xFF,
            (offset >>> 16) & 0xFF,
            (offset >>> 8) & 0xFF,
            offset & 0xFF // data_offset
        ],0);
        for (i = 0; i < len; i++) {
            sample = samples[i];
            duration = sample.duration;
            size = sample.size;
            flags = sample.flags;
            cts = sample.cts;
            array.set([
                (duration >>> 24) & 0xFF,
                (duration >>> 16) & 0xFF,
                (duration >>> 8) & 0xFF,
                duration & 0xFF, // sample_duration
                (size >>> 24) & 0xFF,
                (size >>> 16) & 0xFF,
                (size >>> 8) & 0xFF,
                size & 0xFF, // sample_size
                (flags.isLeading << 2) | flags.dependsOn,
                (flags.isDependedOn << 6) |
                (flags.hasRedundancy << 4) |
                (flags.paddingValue << 1) |
                flags.isNonSync,
                flags.degradPrio & 0xF0 << 8,
                flags.degradPrio & 0x0F, // sample_flags
                (cts >>> 24) & 0xFF,
                (cts >>> 16) & 0xFF,
                (cts >>> 8) & 0xFF,
                cts & 0xFF // sample_composition_time_offset
            ],12+16*i);
        }
        return MP4.box(MP4.types.trun, array);
    }

    static initSegment(tracks, duration, timescale) {
        if (!MP4.types) {
            MP4.init();
        }
        var movie = MP4.moov(tracks, duration, timescale), result;
        result = new Uint8Array(MP4.FTYP.byteLength + movie.byteLength);
        result.set(MP4.FTYP);
        result.set(movie, MP4.FTYP.byteLength);
        return result;
    }
}
let track_id = 1;
class BaseRemuxer {

    static PTSNormalize(value, reference) {
        return value;

        let offset;
        if (reference === undefined) {
            return value;
        }
        if (reference < value) {
            // - 2^33
            offset = -8589934592;
        } else {
            // + 2^33
            offset = 8589934592;
        }
        /* PTS is 33bit (from 0 to 2^33 -1)
         if diff between value and reference is bigger than half of the amplitude (2^32) then it means that
         PTS looping occured. fill the gap */
        while (Math.abs(value - reference) > 4294967296) {
            value += offset;
        }
        return value;
    }

    static getTrackID() {
        return track_id++;
    }

    constructor(track) {
        //this.timeOffset = -1;
        this.timeOffset=0
        this.timescale = Number(track.rtpmap[""+track.fmt[0]].clock);
         this.scaleFactor = (this.timescale|0)/1000;
        this.readyToDecode = false;
        this.seq = 1;
    }

    msToScaled(timestamp) {
        return (timestamp - this.timeOffset)* this.scaleFactor;
    }

    remux(rtpPacket) {
        return (this.timeOffset >= 0);
    }
}
class NALU {

    static get NDR() {return 1;}
    static get IDR() {return 5;}
    static get SEI() {return 6;}
    static get SPS() {return 7;}
    static get PPS() {return 8;}
    static get FU_A() {return 28;}
    static get FU_B() {return 29;}

      static get TYPES() {return {
          [NALU.IDR]: 'IDR',
          [NALU.SEI]: 'SEI',
          [NALU.SPS]: 'SPS',
          [NALU.PPS]: 'PPS',
          [NALU.NDR]: 'NDR'
      }};


    static type(nalu) {
        if (nalu.ntype in NALU.TYPES) {
            return NALU.TYPES[nalu.ntype];
        } else {
            return 'UNKNOWN';
        }
    }

    constructor(ntype, nri, data, timestamp) {

      this.data      = data;
      this.ntype     = ntype;
      this.nri       = nri;
      this.timestamp = timestamp;
    }

    appendData(idata) {
      this.data = appendByteArray(this.data, idata);
    }

    type() {
        return this.ntype;
    }
    getNri() {
        return this.nri >> 6;
    }
    getSize() {
      return 4 + 1 + this.data.byteLength;
    }

    getData() {
        let header = new Uint8Array(5+this.data.byteLength);
        let view = new DataView(header.buffer);
        view.setUint32(0, this.data.byteLength+1);
        view.setUint8(4, (0x0 & 0x80) | (this.nri & 0x60) | (this.ntype & 0x1F));
        header.set(this.data, 5);
        return header;
    }
}
class NALUAsm {
    static get NALTYPE_FU_A() {return 28;}
    static get NALTYPE_FU_B() {return 29;}

    constructor() {
        this.nalu_l = null;
        this.nalu_t = null;
        this.dts_l = 0;
    }
    shiftTemp(val) {
        let ret;
        if (this.nalu_t != null) {
            ret = this.nalu_t;
            this.nalu_t = val;
        } else {
            ret = val;
        }
        return ret ? [ret] : null;
    }
    onRTPPacket(pkt/*RTPPacket*/) {
        let rawData = pkt.getPayload();
        let dts = pkt.getTimestampMS();
        if (!pkt.media) {
            return null;
        }
        let data = new DataView(rawData.buffer, rawData.byteOffset);

        let nalhdr = data.getUint8(0);
        //console.log("Log debug key frame: "+nalhdr+", "+data.getUint8(1));
        let nri = nalhdr & 0x60;
        let naltype = nalhdr & 0x1F;
        //console.log(naltype);
        let nal_start_idx = 1;
        let ret = null;
        if ((7 > naltype && 0 < naltype) || (28 > naltype && 8 < naltype)) {
           // return new NALU(naltype, nri, rawData.subarray(nal_start_idx), dts);
             if (this.dts_l != dts) {
                this.dts_l = dts;
                ret = this.shiftTemp(this.nalu_l);
                this.nalu_l = new NALU(naltype, nri, rawData.subarray(nal_start_idx), dts);
            } else {
                ret = this.shiftTemp(null);
                if (this.nalu_l != null) {
                    this.nalu_l.appendData(new Uint8Array([0, 0, 1]));
                    this.nalu_l.appendData(rawData.subarray(0));
                }
            }
            return ret;
        } else if (naltype == NALU.SPS || naltype == NALU.PPS) {
            return [new NALU(naltype, nri, rawData.subarray(nal_start_idx), dts)];
        }else if (NALU.FU_A == naltype || NALU.FU_B == naltype) {
            let nalfrag = data.getUint8(1);
            let nfstart = (nalfrag & 0x80) >>> 7;
            let nfend = (nalfrag & 0x40) >>> 6;
            let nftype = nalfrag & 0x1F;

            nal_start_idx++;
            let nfdon = 0;
            if (NALU.FU_B === naltype) {
                nfdon = data.getUint16(2);
                nal_start_idx += 2;
            }
            if (this.dts_l != dts) {
                console.log("info nalfrag: "+nalfrag+"-"+nfstart+"-nal_type:"+nftype);
                if (nfstart) {
                    ret = this.shiftTemp(this.nalu_l);
                    this.nalu_l = new NALU(nftype, nri + nftype, rawData.subarray(nal_start_idx), dts);
                    //this.nalu_l = new NALU(nftype, nri, rawData.subarray(nal_start_idx), dts);
                    this.dts_l = dts;

                } else {
                   // this.nalu_l.appendData(new Uint8Array([0, 0, 1, nri + nftype]));
                    //this.nalu_l.appendData(rawData.subarray(nal_start_idx));
                    ret = this.shiftTemp(null);
                    //ret = this.shiftTemp(null);
                    console.log("fu packet error: nalfrag: "+nalfrag+"-"+nfstart);
                    Log('Gói lỗi không thể decode, bỏ qua','warning');

                }
            } else {
                if (this.nalu_l != null) {
                    if (this.nalu_l.ntype == nftype) {
                        ret = this.shiftTemp(null);
                        if (nfstart) {
                            this.nalu_l.appendData(new Uint8Array([0, 0, 1, nri + nftype]));
                            //this.nalu_l.appendData(new Uint8Array([0, 0, 1, nri]));
                            this.nalu_l.appendData(rawData.subarray(nal_start_idx));
                        } else {
                            this.nalu_l.appendData(rawData.subarray(nal_start_idx));
                        }
                    } else {
                        if (nfstart) {
                            ret = this.shiftTemp(this.nalu_l);
                            this.nalu_l = new NALU(nftype, nri + nftype, rawData.subarray(nal_start_idx), dts);
                            //this.nalu_l = new NALU(nftype, nri , rawData.subarray(nal_start_idx), dts);
                            this.dts_l = dts;
                        } else {
                            ret = this.shiftTemp(null);
                            console.log("fu packet error");

                        }
                    }
                } else {
                    ret = this.shiftTemp(null);
                    console.log("fu packet start without head");
                }
            }
            return ret;
        } else {
            /* 30 - 31 is undefined, ignore those (RFC3984). */
            console.log('Undefined NAL unit, type: ' + naltype);
            Log('Undefined NAL unit, type: ' + naltype,'error')
            ret = this.shiftTemp(null);
            return ret;
        }
    }
}
class H264TrackConverter extends BaseRemuxer {

    constructor(track) {
        super(track);
        this.codecstring=MSE.CODEC_AVC_BASELINE;

        this.units=[];
        this._initDTS = undefined;
        this.nextAvcDts = undefined;

        this.naluasm = new NALUAsm();
        this.readyToDecode = false;

        this.firstDTS=0;
        this.firstPTS=0;
        this.lastDTS=undefined;

        this.mp4track={
            id:BaseRemuxer.getTrackID(),
            type: 'video',
            nbNalu: 0,
            fragmented:true,
            sps:'',
            pps:'',
            width:0,
            height:0,
            samples: []
        };

        if (track.fmtp['sprop-parameter-sets']) {
            let sps_pps = track.fmtp['sprop-parameter-sets'].split(',');
            this.mp4track.pps=[new Uint8Array(base64ToArrayBuffer(sps_pps[1]))];
            this.parseTrackSPS(base64ToArrayBuffer(sps_pps[0]));
        }
        this.timeOffset = 0;
    }

    parseTrackSPS(sps) {
        var expGolombDecoder = new ExpGolomb(new Uint8Array(sps));
        var config = expGolombDecoder.readSPS();

        this.mp4track.width = config.width;
        this.mp4track.height =config.height;
        //lb_resolution.text(config.width+'x'+config.height);
        this.mp4track.sps = [new Uint8Array(sps)];
        this.mp4track.timescale = this.timescale;
        this.mp4track.duration = this.timescale;
        var codecarray = new DataView(sps,1,4);
        this.codecstring = 'avc1.';
        for (let i = 0; i < 3; i++) {
            var h = codecarray.getUint8(i).toString(16);
            if (h.length < 2) {
                h = '0' + h;
            }
            this.codecstring += h;
        }
        this.mp4track.codec = this.codecstring;
    }

    remux(rtpPacket) {
        if (!super.remux.call(this, rtpPacket)) return;

        let nalu = this.naluasm.onRTPPacket(rtpPacket);

        if (nalu) {
            let push = false;
            nalu = nalu[0];
            switch (nalu.type()) {
                case NALU.NDR:
                    if (this.readyToDecode) {
                        push=true;
                    }
                    break;
                case NALU.IDR:
                    if (!this.readyToDecode) {
                        if (this.mp4track.pps && this.mp4track.sps) {
                            push = true;
                            this.readyToDecode = true;
                            if (this._initDTS === undefined) {
                                this._initPTS = this.msToScaled(nalu.timestamp);
                                this._initDTS = this.msToScaled(nalu.timestamp);
                            }
                        }
                    } else {
                        push = true;
                        // this.flush = true;
                    }
                    break;
                case NALU.PPS:
                    if (!this.mp4track.pps) {
                        this.mp4track.pps = [new Uint8Array(nalu.data)];
                    }
                    break;
                case NALU.SPS:
                    if(!this.mp4track.sps) {
                        this.parseTrackSPS(nalu.data);
                    }
                    break;
                default: push = false;

            }

            // TODO: update sps & pps
            if (this.readyToDecode) {
                // TODO: mux it

                if (push) {

                    this.units.push(nalu);

                }
            }
        }
    }
    getPayload() {
            this.mp4track.len = 0;
            this.mp4track.nbNalu = 0;
            for (let unit of this.units) {
                this.mp4track.samples.push({
                    units: {
                        units: [unit],
                        length: unit.getSize()
                    },
                    pts: this.msToScaled(unit.timestamp),
                    dts: this.msToScaled(unit.timestamp),
                    key: unit.type() == NALU.IDR
                });
                this.mp4track.len+=unit.getSize();
                this.mp4track.nbNalu+=1;
            }

            let payload = new Uint8Array(this.mp4track.len);
            let offset = 0;
            let samples=[];

            this.mp4track.samples.sort(function(a, b) {
                return (a.pts-b.pts);
            });

            let ptsnorm, dtsnorm, sampleDuration=0 ,mp4Sample, lastDTS;
            while (this.mp4track.samples.length) {
                let avcSample = this.mp4track.samples.shift();
                let mp4SampleLength = 0;
                // convert NALU bitstream to MP4 format (prepend NALU with size field)
                while (avcSample.units.units.length) {
                    let unit = avcSample.units.units.shift();
                    let unit_data = unit.getData();
                    payload.set(unit_data, offset);
                    offset += unit_data.byteLength;
                    mp4SampleLength += unit_data.byteLength;
                }
                let pts = avcSample.pts - this._initPTS;
                let dts = avcSample.dts - this._initDTS;
                // ensure DTS is not bigger than PTS
                dts = Math.min(pts,dts);
                if (lastDTS !== undefined) {
                    ptsnorm = BaseRemuxer.PTSNormalize(pts, lastDTS);
                    dtsnorm = BaseRemuxer.PTSNormalize(dts, lastDTS);
                    sampleDuration = (dtsnorm - lastDTS);
                    if (sampleDuration <= 0) {
                        console.log(`invalid sample duration at PTS/DTS: ${avcSample.pts}/${avcSample.dts}|dts norm: ${dtsnorm}|lastDTS: ${lastDTS}:${sampleDuration}`);
                        /*Bo qua cac frame loi*/
                        //this.mp4track.len -= unit.getSize();
                        continue;
                    }
                } else {
                    var nextAvcDts = this.nextAvcDts, delta;
                    // first AVC sample of video track, normalize PTS/DTS
                    ptsnorm = BaseRemuxer.PTSNormalize(pts, nextAvcDts);
                    dtsnorm = BaseRemuxer.PTSNormalize(dts, nextAvcDts);
                    if (nextAvcDts) {
                        delta = Math.round((dtsnorm - nextAvcDts) /*/ RTSPStream.SCALE_FACTOR*/);
                        // if fragment are contiguous, or delta less than 600ms, ensure there is no overlap/hole between fragments
                        if (/*contiguous ||*/ Math.abs(delta) < 600) {
                            if (delta) {
                                if (delta > 1) {
                                    console.log(`AVC:${delta} ms hole between fragments detected,filling it`);
                                } else if (delta < -1) {
                                    console.log(`AVC:${(-delta)} ms overlapping between fragments detected`);
                                }
                                // set DTS to next DTS
                                dtsnorm = nextAvcDts;
                                // offset PTS as well, ensure that PTS is smaller or equal than new DTS
                                ptsnorm = Math.max(ptsnorm - delta, dtsnorm);
                                console.log(`Video/PTS/DTS adjusted: ${ptsnorm}/${dtsnorm},delta:${delta}`);
                            }
                        }
                    }
                    // remember first PTS of our avcSamples, ensure value is positive
                    this.firstPTS = Math.max(0, ptsnorm);
                    this.firstDTS = Math.max(0, dtsnorm);
                    sampleDuration = 1;
                }
                //console.log('PTS/DTS/initDTS/normPTS/normDTS/relative PTS : ${avcSample.pts}/${avcSample.dts}/${this._initDTS}/${ptsnorm}/${dtsnorm}/${(avcSample.pts/4294967296).toFixed(3)}');
                mp4Sample = {
                    size: mp4SampleLength,
                    duration: sampleDuration,
                    cts: (ptsnorm - dtsnorm) /*/ RTSPStream.SCALE_FACTOR*/,
                    flags: {
                        isLeading: 0,
                        isDependedOn: 0,
                        hasRedundancy: 0,
                        degradPrio: 0
                    }
                };
                let flags = mp4Sample.flags;
                if (avcSample.key === true) {
                    // the current sample is a key frame
                    flags.dependsOn = 2;
                    flags.isNonSync = 0;
                } else {
                    flags.dependsOn = 1;
                    flags.isNonSync = 1;
                }
                samples.push(mp4Sample);
                lastDTS = dtsnorm;
            }

            var lastSampleDuration = 0;
            if (samples.length >= 2) {
                lastSampleDuration = samples[samples.length - 2].duration;
                samples[0].duration = lastSampleDuration;
            }
            // next AVC sample DTS should be equal to last sample DTS + last sample duration
            this.nextAvcDts = dtsnorm + lastSampleDuration /** RTSPStream.SCALE_FACTOR*/;

            if(samples.length && navigator.userAgent.toLowerCase().indexOf('chrome') > -1) {
                let flags = samples[0].flags;
                // chrome workaround, mark first sample as being a Random Access Point to avoid sourcebuffer append issue
                // https://code.google.com/p/chromium/issues/detail?id=229412
                flags.dependsOn = 2;
                flags.isNonSync = 0;
            }
            this.mp4track.samples = samples;
            if (samples.length) {
                this.mp4track.lastDuration = (this.lastDTS||0) + samples[samples.length - 1].duration;
            } else {
                this.mp4track.lastDuration = 0;
            }
            return payload;
    }
    flush() {
        this.seq++;
        this.mp4track.samples = [];
        this.units = [];
    }
}
class TypeStreaming{
    static get HLS(){return 'hls';}
    static get RTP(){return 'rtp';}
}
class WebsocketTransport{
	constructor(remuxer,wsSrc,player){
    //super();
    this.remuxer = remuxer;
    this.ret = this.urlParse(wsSrc);
    this.checkonmessage = false;
    this.socket_url =this.ret.full;
    this.rtp_url = this.ret.fullg;
    this.host_id = this.ret.host_id;
    this.ready = this.connect();
    this.sdpfile=null;
    this.count=0;
    this.player = player;
    var self = this;
    this.websocket.onopen = function(evt) { self.onOpen(evt); };
    this.websocket.onmessage = function(evt) { self.onMessage(evt); };
    this.websocket.onerror = function(evt) { self.onError(evt); };
	}
	connect() {
    this.RTPClient = new RTPClient(this.remuxer);
    this.websocket = new WebSocket(this.socket_url);
    if(window.MozWebSocket)
    {
      window.WebSocket = window.MozWebSocket;
    }
    else if (!window.WebSocket)
    {
      return;
    }

    var self = this;
    this.websocket.onopen = function(evt) { self.onOpen(evt); };
    this.websocket.onclose = function(evt) { self.onClose(evt); };
    this.websocket.onmessage = function(evt) { self.onMessage(evt); };
    this.websocket.onerror = function(evt) { self.onError(evt); };
	}
  onOpen(evt){
    Log('Kết nối socket thành công, gửi xác thực host_id:'+this.host_id,'info');
    this.websocket.send('{ "action":"hello", "version":"2.0", "host_id":"'+this.host_id+'", "signature":"RESERVED", "timestamp":"1480371820539" }');
    this.CheckonMessage();
  }
	onClose(e){
      this.count=0;
      Log('Không thể kết nối đến server, kiểm tra lại url','error');
      console.log(e);
      this.onDisconnect();
      //this.dispatchEvent('disconnected', {code: e.code, reason: e.reason});
      //if ([1000, 1006, 1013, 1011].includes(e.code)) {
          /*setTimeout(()=> {
            Log('Khởi tạo lại kết nối sau 4s...','info');
            new VCamPlayer(this.player.id,{transport:this.socket_url});
          }, 4000);*/
      //}
      //new VCamPlayer(this.player.id,{transport:this.socket_url});
  }
  onError(e)
  {
    //this.dispatchEvent('error',{code:404,message:'Error connect socket'});
  }
  onDisconnect(evt)
  {
    console.log('DISCONNECTED SUCCESS!!');
    Log('Đóng kết nối đến socket','error');
    this.websocket.close();
    this.RTPClient.stopStreamFlush();
  }
  onMessage(evt)
  {
    //console.log(evt.data);
    if (this.count>0) {
      if (this.count==1) {
        this.count++;
        let InfoInit = JSON.parse(evt.data);
       // console.log(InfoInit);
        this.sdpfile=InfoInit.data;
        if (this.sdpfile===null||typeof this.sdpfile === "undefined" ) {
          //this.sdpfile = 'v=0\no=- 0 0 IN IP4 127.0.0.1\ns=mychns\nc=IN IP4 127.0.0.1\nt=0 0\na=tool:NamVision-cdn-3.0\nm=video 44176 RTP/AVP 96\na=rtpmap:96 H264/90000\na=fmtp:96 packetization-mode=1; sprop-parameter-sets=Z00AHp2oKAtpuAgICBA=,aO48gA==; profile-level-id=4D001E\n';
        }
        else{
           this.RTPClient.sdpparse(this.sdpfile.replace('SDP:\n',''));
        }
      }
      else{

        if (evt.data instanceof Blob) {
           console.log('Blob');
        }
        else{

          this.checkonmessage=true;
          let data_convert = evt.data.replace("[","");
          let url_id = data_convert.split(",");
          let url_download=this.rtp_url.concat(url_id[0]);
          //this.RTPClient.flush(url_download);
          this.RTPClient.rtpdownload(url_download,url_id[0]);
        }

      }
    }
    this.count++;
  }
  urlParse(url){
    console.log(url);
    let protocolg=null;
    let regex = /^([^:]+):\/\/([^\/]+)(.*)$/;
    url = url.replace('ws://','wss://');;
    let result = regex.exec(url);
    if (!result) {
        Log('Lỗi URL','error');
        //throw new Error("Bad url");
        return false;
    }
    let ret = {};
    ret.full = url.replace('ws://','wss://');
    ret.protocol = result[1];
    ret.urlpath = result[3];
    ret.hostname=result[2];
    let parts = ret.urlpath.split('/');
    ret.host_id =parts[2];
    ret.channel_id =parts[3];
    if (ret.protocol=='ws')protocolg='http';
    else if(ret.protocol=='wss')protocolg='https';
    else return null;
    ret.fullg = protocolg+'://'+ret.hostname+'/live/g/'+ret.channel_id+'/';
    return ret;
  }
  CheckonMessage() {
    this.checkInterval = setInterval(()=>{
        if (!this.checkonmessage) Log('Kết nối thành công nhưng không nhận được file download, kiểm tra link','error');
        clearInterval(this.checkInterval);
    }, 6000);
  }
}

class RTPClient{
  constructor(remuxer){
    this.remuxer = remuxer;
    this.sdp = new SDPParser;
    this.sps_pps=false;
    this.sps=null;
    this.pps=null;
    /*
    _Helper._seqMap[_Helper._seqIdx] = new Map();
    this.seqMap = _Helper._seqMap[_Helper._seqIdx];
    this.seqIdx = _Helper._seqIdx++; */

    this.seqMap = new Map();

    _Helper._rtp_client[_Helper._rtpcount] = this;
    this._id = _Helper._rtpcount++;

    this.startFlush();
  }
  clean(){
    this.remuxer = null;
    this.sdp = null;
//    this.seqMap = null;
//    _Helper._seqMap[this.seqIdx] = null;
    _Helper._rtp_client[this._id] = null;
  }
  sdpparse(sdp_body){
    this.sdp.parse(sdp_body).catch(function () {
        throw new Error("Failed to parse SDP");
      }).then(function () {
          return sdp_body;
    });
    this.tracks = this.sdp.getMediaBlockList();
    let streams=[];
    for (let track_type of this.tracks) {
      let track = this.sdp.getMediaBlock(track_type);
      this.remuxer.setTrack(track, streams[track_type]);
    }
    this.startStreamFlush();
    this.sps_pps=true;

  }
  startStreamFlush() {
    this.flushStreamInterval = setInterval(()=>{
        if (this.remuxer) this.remuxer.flush();
    }, 400);
  }
  startFlush() {
  /*  this.flushinterval = setInterval(()=>{
        this.flush();
    }, 40); */
  }
  stopStreamFlush() {
    this.remuxer.sendTeardown();
    clearInterval(this.flushInterval);
    clearInterval(this.flushStreamInterval);
    this.clean();
  }
  rtpdownload(url,seq){
     this.seqMap.set(Number(seq),null);
     try{
          let xhr = new XMLHttpRequest();
          xhr.responseType = 'arraybuffer';
          xhr.timeout = 5000;
          xhr._id = this._id;
          xhr._seq = Number(seq);
          xhr.open('GET',url,true);
          xhr.onload = function(){
              if (this.status==200){
                  if (_Helper._rtp_client[this._id].seqMap.has(this._seq))
                    _Helper._rtp_client[this._id].seqMap.set(this._seq,this.response);
              }
              else if(this.status==412){
                  if (_Helper._rtp_client[this._id].seqMap.has(this._seq))
                    _Helper._rtp_client[this._id].seqMap.delete(this._seq);
              }
              _Helper._rtp_client[this._id].flush();
          };
          let handler = function(e){
              if (_Helper._rtp_client[this._id].seqMap.has(this._seq))
                _Helper._rtp_client[this._id].seqMap.delete(this._seq);
              _Helper._rtp_client[this._id].flush();
          }

          xhr.onerror = handler;
          xhr.ontimeout = handler;

          xhr.send(null);
      } catch(e) {
          if (this.seqMap.has(Number(seq)))
                this.seqMap.delete(Number(seq));
          console.log(e);
      }
  }


  flush(){
    try{
        for (var [key, value] of this.seqMap) {
          if(value&&value!=='error')
          {
            //  console.log("Run......"+key);
              let packet =new Uint8Array(value);
              let start=0;
              let buffer_length = packet.length;
              let view_data = new DataView(value);
              this.seqMap.delete(key);
              while(start < buffer_length){
                let rtp_size = view_data.getUint16(start)+2;
                let packet_feed = packet.subarray(start,start+rtp_size);
                if(this.sps_pps)this.remuxer.feedRTP(new RTP(packet_feed, this.sdp));
                else{
                    let rawData = packet_feed.subarray(12);
                    let data = new DataView(rawData.buffer, rawData.byteOffset);
                    let nalhdr = data.getUint8(0);
                    var nftype = nalhdr & 0x1F;
                    if (nftype==7) {
                      this.sps=u8ToBase64(rawData);
                    }
                    if(nftype==8){
                      this.pps=u8ToBase64(rawData);
                    }
                    if(this.pps!==null&&this.sps!==null){
                      let sdpfile = 'v=0\no=- 0 0 IN IP4 127.0.0.1\ns=mychns\nc=IN IP4 127.0.0.1\nt=0 0\na=tool:NamVision-cdn-3.0\nm=video 0 RTP/AVP 96\na=rtpmap:96 H264/90000\na=fmtp:96 packetization-mode=1; sprop-parameter-sets='+this.sps+','+this.pps+'; profile-level-id=4D001E\n';
                      this.sdpparse(sdpfile);
                    }
                }
                start+=rtp_size;
              }
          }
          else
                return false;
        }
      } catch(e) {
          console.log(e);
          return false;
      }
  }
}
class VCamPlayer{
	constructor(video_node,module){
		if(typeof video_node===typeof ''){
			this.player = document.getElementById(video_node);
		}else{
			this.player = video_node;
		}
    var self = this;
    this.wsSrc = module.transport;
    this.errorListener = this.stop.bind(this);
    //Khởi tạo MSE
    this.mse = new MSE([this.player]);
    this.setSource();
	}
  isPlaying() {
    return !(this.player.paused || this.client.paused);
  }
  setSource() {
    this.remuxer = new Remuxer();
    this.remuxer.attachMSE(this.mse);
    this.mse.eventSource.addEventListener('error', this.errorListener);
    this.transport = new WebsocketTransport(this.remuxer,this.wsSrc,this.player);
  }
  start() {
    this.client.start();
  }
  stop() {
    console.log('Client stop');
    this.transport.onDisconnect();
  }
}
let _Helper = {
    _rtpcount : 0,
    _rtp_client : [],
    _seqIdx: 0,
    _seqMap:[],
    _version : '1.5a'
}

function Log(text,log_type) {
    console.log(log_type+ ': '+ text);
/*
    var color='#FF0000';
    if (log_type=='info') {
      color='#008000';
    }
    if (log_type=='warning') {
      color='#DAA520';
    }
    console.log(" - "+log_type+": <span style='color:"+color+"'>"+text+"</span><br />");
    var log_date = moment().format('h:mm:ss');
    logger.scrollTop = logger.scrollHeight;
    log.innerHTML+=log_date+" - "+log_type+": <span style='color:"+color+"'>"+text+"</span><br />";
    log_message=text;
    */
}
