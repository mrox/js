function appendByteArray(buffer1, buffer2) {
    let tmp = new Uint8Array((buffer1.byteLength|0) + (buffer2.byteLength|0));
    tmp.set(buffer1, 0);
    tmp.set(buffer2, buffer1.byteLength|0);
    return tmp;
}
function RTPU(pkt,idx) {
    let bytes = new DataView(pkt.buffer, idx+2, 8);
    this.payload = pkt.subarray(12);
    this.timestamp = bytes.getFloat64(0);
    // console.log(this.timestamp);
}
function NALU(_ntype, _nri, _data, _timestamp) {
    this.data      = _data;
    this.ntype     = _ntype;
    this.nri       = _nri;
    this.timestamp = _timestamp;
}

function STMCPlayer(ws_src) {
    this._dltimeout = 5000;
    this._currentMetaTS = 10;
    this.started = false;
    this._ws_src = ws_src;
    this._canvas = document.createElement('canvas');
    this._buffer = [];
    this.sps = false;
    this.nalu_l = null;
    this.ts_l = 0;
    this.wsConnected_timeout = 20000;
    this.wsConnected_timer = null;

    let seqMap = new Map();
    _Helper.seqMap.push(seqMap);
    _Helper.isMe.push(this);
    this.seqM_idx = _Helper.seqMap.length-1;
    this.seqMap =  _Helper.seqMap[this.seqM_idx];
    this.onFrame = function(e){};

    this.openSocket(this._ws_src);
    self = this;
    // setInterval(
    //     self.flush.bind(self),100
    // );
}

STMCPlayer.prototype.handleWsTimeout = function() {
    clearTimeout(this.wsConnected_timer);
    let self = this;
    this.wsConnected_timer = setTimeout(function() {
        console.log('ws connection timeout')
        self.reset();
    }, self.wsConnected_timeout);
}

STMCPlayer.prototype.reset = function() {
    console.log('reset ws')
    this.openSocket();
}

STMCPlayer.prototype.parseWsData = function(data){
    console.log('parsing',data);
    let view = new DataView(data.buffer);
    let idx = 0;

    while(idx < view.byteLength-2){
        let len = view.getUint16(idx);
        let nal_header =  view.getUint8(idx+12);
        let nal_type = nal_header & 0x1f;

        if (idx+2+len-1< view.byteLength && idx+12 < view.byteLength){
            idx +=  2 + len;            
        }            
    }        
    console.log(view.byteLength, idx);
}

STMCPlayer.prototype.flush = function(max=null) {
    if (!max)
        max = this._currentMetaTS;
    for (var [key, value] of this.seqMap) {
        if (value) {
            this.slicePkts(value);
            this.seqMap.delete(key);            
        }
        else break;
    }
}

STMCPlayer.prototype.downloadPacket = function(packet_id){
    this.seqMap.set(packet_id,null);
    let packet_url = this.baseurl + packet_id;
    let xhr = new XMLHttpRequest();
    let self = this;
    xhr.packet_id = packet_id;
    xhr.seqM_idx = this.seqM_idx;
    xhr.responseType = 'arraybuffer';
    xhr.timeout = this._dltimeout;
    xhr.open('GET', this.baseurl.concat(packet_id), true);
    xhr.onload = function () {
        let seqMap = _Helper.seqMap[this.seqM_idx];
        if (this.status == 200) {
            if (seqMap.has(this.packet_id))            
                seqMap.set(this.packet_id, this.response);
        }
        else{
            if (seqMap.has(this.packet_id))            
                seqMap.delete(this.packet_id);
        }
        _Helper.isMe[this.seqM_idx].flush();
       // self.flush();
    }
    let handler = function (e) {
        try {            
            let seqMap = _Helper.seqMap[this.seqM_idx];            
            if (seqMap.has(this.packet_id))            
                seqMap.delete(this.packet_id);     
        } catch (e){}
        _Helper.isMe[this.seqM_idx].flush();
        // self.flush();
    }
    xhr.onerror = handler;
    xhr.ontimeout = handler;    
    xhr.send(null);
}

STMCPlayer.prototype.onMsgReicv = function (msg) {
    console.log('=========>>>>> onMsgReicv')
    this.handleWsTimeout();
    
    if (typeof msg.data == 'string') {
        let match = msg.data.match(/\[([0-9]+), .+,.+,(.+[0-9]+).+/);
        if (match) {
            // console.log(match[2]);
            if (this.started || match[2].match(/78[05]/)){ 
                this.started = true;
                this.downloadPacket(match[1]);  
            }
        }
    }
}

STMCPlayer.prototype.onSkOpen = function (msg) {
    this._ws.send('{ "action":"hello", "version":"2.0", "host_id":"' + this.host_id + '", "signature":"RESERVED", "timestamp":"1480371820539" }');
}

STMCPlayer.prototype.openSocket = function () {
    //this._ws_src = "ws://1v1.vcam.viettel.vn/evup/4711_1519814201/005a205207fexyz57064"; // for testing
    let match_url = this._ws_src.match(/ws[s]*:\/\/(.+)\/evup\/(.+)\/(.+)/);
    console.log('open socket',match_url)
    this.handleWsTimeout();

    if (match_url) {
        this.host_id = match_url[2];
        this.baseurl = `https://${match_url[1]}/live/g/${match_url[3]}/`;
        this._ws = new WebSocket(this._ws_src);

        let self = this;
        this._ws.onopen = this.onSkOpen.bind(this);
        this._ws.onmessage = this.onMsgReicv.bind(this);
    }
}

STMCPlayer.prototype.parseNALU = function(rtpu) {
    let ret = null;
    let nalhdr =  rtpu.payload[0];
    let nri = nalhdr & 0x60;
    let naltype = nalhdr & 0x1F;
    let nal_start_idx = 1;
    switch(naltype) {
        case 7:
        case 8:
        case 5:
        case 1:
            ret = new NALU(naltype, nri, rtpu.payload.subarray(1), rtpu.timestamp);
            break;
        case 28: // FU-A
        {
            nal_start_idx = 2;
            let nalfrag = rtpu.payload[1];
            let nfstart = (nalfrag & 0x80) >>> 7;
            let nfend = (nalfrag & 0x40) >>> 6;
            let nftype = nalfrag & 0x1F;
            // console.log(naltype," ",nfstart," ",nfend," ",nftype)
            if (nfstart) {
                this.ts_l = rtpu.timestamp;
                this.nalu_l = rtpu.payload.subarray(2);
            }
            else if (this.nalu_l && (this.ts_l === rtpu.timestamp)) {
                let temp = appendByteArray(this.nalu_l, rtpu.payload.subarray(2));
                if(nfend) {
                    ret = new NALU(nftype, nri, temp, rtpu.timestamp);
                    this.nalu_l = null;
                }
                else {
                    this.nalu_l = temp;
                }
            }
            else {
                console.log('error [FU-A].... ')
            }
        }
            break;
        default:
            break;
    }
    return ret;
}

STMCPlayer.prototype.slicePkts = function(data) {
    let raw  = new Uint8Array(data);
    let view = new DataView(data);
    let idx = 0;
    
    while(idx < view.byteLength-2){
        let len = view.getUint16(idx);
        if (idx+2+len-1< view.byteLength && idx+12 < view.byteLength){
            let packet_feed = raw.subarray(idx,idx+len+2);
            let nalu = this.parseNALU(new RTPU(packet_feed,idx));
            if(nalu) {
                this.onFrame(nalu);
            }
            idx +=  2 + len;
        }
        else
            break;
    }
}

_Helper = {
    seqMap : [],
    isMe: [],
}
