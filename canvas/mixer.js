let mhelper = {
    version:"20100119-1317",
    debug_full: false,
    debug_en: false,
    debug_ws: false,
    debug_tk: false,
    debug_re: false,
    debug_dc: false,
};

let TS_STATE = {
    NONE: 0x00,
    ONLY_WS: 0x01,
    ONLY_EN: 0x02,
    FULL: 0x03
};

function MixedItem() {
    this.timestamp = 0;
    this.buffer = null;
    this.einfo = [];
}

function tlog(msg, option = false) {
    if (mhelper.debug_full || option) {
        console.log(msg);
    }
}

function Mixer() {
    this.enbuffer = [];
    this.wsbuffer = [];
    this.pics = [];

    this.curTs = 0;
    this.enTs = 0;
    this.wsTs = 0;
    this.nextEnItem = new MixedItem();
    this.nextWsItem = new MixedItem();

    this.enRunning = false;
    this.wsRunning = false;
    this.firstMatching = false;
    this.firstTs = 0;
    this.tick();

    this.max_ws = 300;
    this.max_en = 300;
    this.max_ws_re = 200;
    this.max_ws_en = 200;
}
Mixer.prototype.pushEngine = function (pkg) {
    if(pkg.timestamp) {
        tlog("_pushEngine "+pkg.timestamp, mhelper.debug_en);
        if (!this.enRunning) {
            console.log("[matching] Engine started");
            this.enRunning = true;
            this.nextEnItem = pkg;
        }
        else {
            if (!this.wsRunning) return;
            if (this.enbuffer.length < this.max_en) {
                this.enbuffer.push(pkg);
            }
        }
    }
    else {
        tlog("_pushEngine<none timestamp>", mhelper.debug_en);
    }
}
Mixer.prototype.pushWs = function (pkg) {
    if (pkg.timestamp) {
        tlog("_pushWs "+pkg.timestamp, mhelper.debug_en);
        if (!this.wsRunning) {
            console.log("[matching] WS started");
            this.wsRunning = true;
            this.nextWsItem = pkg;
        }
        else {
            if (this.wsbuffer.length < this.max_ws) {
                this.wsbuffer.push(pkg);
                if (!this.enRunning) {
                    this.release();
                    this.nextWsItem = this.wsbuffer.shift();
                }
            }
        }
    }
    else {
        tlog("_pushWs<none timestamp>", mhelper.debug_en);
    }
}
Mixer.prototype.push = function (msg = '', pkg) {
    if (msg == 'engine') {
        this.pushEngine(pkg);
    }
    else {
        this.wsbuffer.push(pkg);
    }
}
Mixer.prototype.nextEn = function (sub = 0) {
    tlog("_nextEn[ws-en] " + this.wsbuffer.length+" "+this.enbuffer.length, mhelper.debug_en);
    if (this.wsbuffer.length > this.max_ws_re) {
        this.release();
        this.nextWsItem = this.wsbuffer.shift();
    }
    if (this.enbuffer.length) {
        this.nextEnItem = this.enbuffer.shift();
        this.tick();
    }
    else if (sub > 100) {
        setTimeout(this.nextEn.bind(this), 5);
    }
    else {
        setTimeout(this.nextEn.bind(this), 20);
    }
}
Mixer.prototype.nextWs = function (sub = 0) {
    tlog("_nextWs[ws-en] " + this.wsbuffer.length+" "+ this.enbuffer.length, mhelper.debug_ws);
    if (this.wsbuffer.length) {
        this.nextWsItem = this.wsbuffer.shift();
        if (this.wsbuffer.length > this.max_ws_re) {
            this.release();
            this.nextWsItem = this.wsbuffer.shift();
        }
        this.tick();
    }
    else if (sub > 100) {
        setTimeout(this.nextWs.bind(this), 5);
    }
    else {
        setTimeout(this.nextWs.bind(this), 20);
    }
}
Mixer.prototype.tick = function () {
    tlog("_tick[ws-en] " + this.wsbuffer.length +" "+ this.enbuffer.length, mhelper.debug_tk);
    if (this.enRunning && this.wsRunning) {
        let enTs = this.nextEnItem.timestamp;
        let wsTs = this.nextWsItem.timestamp;
        let sub = Math.abs(enTs - wsTs);
        tlog("_tick[ws-en]: " + wsTs + "-" + enTs + "=" + (wsTs - enTs), mhelper.debug_tk);
        if (enTs < wsTs) {
            this.nextEn(sub);
        }
        else {
            this.release();
            this.nextWs(sub);
        }
    }
    else {
        setTimeout(this.tick.bind(this), 30);
    }
}
Mixer.prototype.release = function () {
    let pic = new MixedItem();
    pic = this.nextWsItem;
    let enTs = this.nextEnItem.timestamp;
    let wsTs = this.nextWsItem.timestamp;
    let compare = Math.abs(wsTs-enTs);
    //console.log(enTs + ' -- ' + wsTs + ' = ' + compare);
    if (compare < 20) {
        pic.state = TS_STATE.FULL;
        pic.einfo = this.nextEnItem.einfo;
        if (!this.firstMatching && (enTs == wsTs)) {
            console.log("[matching] first matching");
            this.firstMatching = true;
            this.firstTs = wsTs;
        }
    }
    else {
        pic.state = TS_STATE.ONLY_WS;
    }
    tlog("_release[ws-en]: " + wsTs + "-" + enTs + "=" + (wsTs - enTs), mhelper.debug_re);
    this.pics.push(pic);
}