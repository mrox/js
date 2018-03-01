
function Size(w,h)
{
    this.width = w;
    this.height = h;
}
function Rect(x,y,w,h)
{
    this.x=x;
    this.y=y;
    this.width=w;
    this.height=h;
}
function scale(r,xunit,yunit)
{
    return new Rect(r.x*xunit, r.y*yunit, r.width*xunit, r.height*yunit);   
}
function drawRect(ctx,r) {
    ctx.rect(r.x,r.y,r.width,r.height);
}
function EslapedTime(max)
{
    this.start = 0;
    this.end = 0;
    this.time = 0;
    this.duration = 0;
    this.avg = 0;
    this.queue = [];
    let self = this;

    this.setPoint = function() {
        let last = this.time;
        this.time = new Date();
        this.duration = this.time-last;
        if (this.queue.length>max) this.queue.shift();
        this.queue.push(this.duration);
        let sum = 0;
        for(let ii=0;ii<this.queue.length;ii++) {
            sum += parseInt(this.queue[ii], 10 );
        }
        this.avg = sum/this.queue.length;
    }
}

let config = {
    size: new Size(1920,1080),
    tracking:{
        color:"green",
        thickness:4,
    },
    cropArea:{
        color:"green",
        thickness:5,
        rect: new Rect(50,600,1800,400)
    },
}

function Player(input, enableMatching=false)
{
    let self = this;
    this.width=1280;
    this.height=720;
    this.fps = 40;//1000/25=40
    this.frames = [];
    this.firstFrame = false;
    this.elapsedDecoder = new EslapedTime(25);
    this.firstDraw = false;
    this.debug_decoder = false;
    this.debug_enSocket = false;
    this.debug_fps = false;
    this.avg = 0;
    this.xrate = 1;
    this.yrate = 1;

    this.en_url = input.en_url;
    this.ws_url = input.ws_url;
    if (input.canvas) {
        console.log("input.canvas", input);
        this.mainLayer= canvas[0];
        this.matchingLayer= canvas[1];
        this.cropLayer= canvas[2];
    }
    else {
        console.log("else input.canvas", input);
        this.mainLayer = document.getElementById('videocanvas');
        this.matchingLayer = document.getElementById('rectcanvas');
        this.cropLayer = document.getElementById('cropcanvas');
    }
    this.display = new WebGLCanvas(this.mainLayer);
    this.decoder = new Worker('js/decoder/decoder.js');
    this.mixer = new Mixer();
    this.decoder.addEventListener('message', function(e){
        self.decoderCallback(e);
    });

    this.h264reader = new STMCPlayer(this.ws_url);
    this.h264reader.onFrame = function(e) {
        self.push2Decoder(e);
    };

    if (enableMatching) {
        this.socket = io.connect(this.en_url);
        this.socket.on('engineInfo', function(e){
            // console.log(e)
            self.pushEngineInfo(e);
        });
    }

    this.draw();
    setInterval(function () {
        console.log('refresh')
        window.location.href = window.location.href;
    }, 1*60*60*10000);
}

Player.prototype.update = function() {
    this.xrate = this.width/config.size.width;
    this.yrate = this.height/config.size.height;
}

function download(data, filename, type) {
    var file = new Blob([].concat.apply([],data), { type: type });
    if (window.navigator.msSaveOrOpenBlob) // IE10+
        window.navigator.msSaveOrOpenBlob(file, filename);
    else { // Others
        var a = document.createElement("a"),
            url = URL.createObjectURL(file);
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(function () {
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        }, 0);
    }
}

Player.prototype.writeFile = function() {
    download(this.frames, 'ws');
}

Player.prototype.writeFile2 = function() {
    let findex = 0;
    let fpr = false;
    setInterval(function () {
        if (fpr) {
            findex++;
            download(_curBuffer, 'web_all', 'text');
        }
    }, 3000);
}

Player.prototype.print = function() {
    console.log('print')
    console.log(this.fps)
    console.log(this.mixer.pics.length)
    console.log(this.mixer.wsbuffer.length)
    console.log(this.mixer.enbuffer.length)
}

Player.prototype.decoderCallback = function(e) {
    this.elapsedDecoder.setPoint();
    if (this.debug_decoder) {
        let tt = this.elapsedDecoder.duration;
        let avg = this.elapsedDecoder.avg;
        let stime = e.data.elapsedTime;
        stime.duration = this.elapsedDecoder.duration;
        stime.fpsAvg = parseInt(this.elapsedDecoder.avg, 10);
        console.log("_dccallback =>> ",stime)
    }
    let message = e.data;
    if (message.data && message.timestamp) {
        // console.log(message)
        if (!this.firstFrame) {
            this.firstFrame = true;
            console.log("firstFrame:",message.timestamp,message.width,message.height);
            this.width = message.width;
            this.height = message.height;
            let canvas = document.getElementsByTagName("canvas");
            for (c of canvas){
                c.width = this.width;
                c.height = this.height;
            }
            this.update();
        }
        let it = new MixedItem();
        it.timestamp = message.timestamp;
        it.buffer = message.data;
        this.mixer.pushWs(it);
    }
}

Player.prototype.push2Decoder = function(nalu) {
    let frame = appendByteArray(new Uint8Array([0,0,1,nalu.ntype|nalu.nri]),nalu.data);
    this.decoder.postMessage({type:'frame', data:frame, timestamp:nalu.timestamp});
}

Player.prototype.pushEngineInfo = function(message) {    
    if (this.debug_enSocket) {
        console.log(message);
    }
    let it = new MixedItem();
    it.timestamp = parseInt(message.timestamp)+40;
    let info = {
        rects: message.rects?message.rects:[],
        speeds: message.speeds?message.speeds:[],
    }
    // console.log('===>>> ', info)
    it.einfo = info;
    this.mixer.pushEngine(it);
}

Player.prototype.fpsCalculator = function(n) {
    let fpsmin=25,fpsnor=38,fpsmax = 50,fpsflush_1 = 10, fpsflush_2 = 1;
    let snor =10,smax = 100,smin = 3;
    let lastfps = this.fps;
    let curfps = fpsnor;

    if(n > snor && n < smax) {
        curfps = (fpsnor - (fpsnor-fpsmin)*(n-snor)/(smax-snor));
    }    
    else if (n < snor) {
        curfps = fpsnor + (fpsmax-fpsnor)*(snor-n)/(snor-smin);
    }
    else if (n < smin) {
        curfps = fpsnor + 5*(8-n);        
    }
    else if (n > (2*smax)) {
        curfps = fpsflush_1;
    }
    else {
        curfps = fpsflush_2;
    }

    if (curfps < lastfps) {
        curfps = Math.max(curfps,lastfps-5);
    }
    else {
        curfps = Math.min(curfps,lastfps+5);
    }
    // curfps = 20;
    if (this.debug_fps) {
        console.log('_fps =>> ',n,curfps)
    }
    return curfps;
}

Player.prototype.fpsCalculator2 = function(n) {
    let fpsmin=25,fpsmax=40, fpsflush_1 = 10, fpsflush_2 = 1;
    let smin =200,smax = 300;
    if (n < smin) {
        return fpsmax;
    }
    else if(n > smin && n < smax) {
        return (fpsmax - (fpsmax-fpsmin)*(n-smin)/(smax-smin));
    }
    else if (n > (2*smax)) {
        return fpsflush_1;
    }
    else {
        return fpsflush_2;
    }
}

Player.prototype.drawCropArea = function() {
    // let ctx = document.getElementById("cropcanvas").getContext("2d");
    let ctx = this.cropLayer.getContext("2d");
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.beginPath();
    ctx.lineWidth = config.cropArea.thickness;
    ctx.strokeStyle = config.cropArea.color;
    let r = new Rect(config.cropArea.rect.x, config.cropArea.rect.y,
            config.cropArea.rect.width, config.cropArea.rect.height)
    let dr = scale(r,this.xrate,this.yrate);
    ctx.rect(dr.x,dr.y,dr.width,dr.height);
    ctx.stroke();
}

Player.prototype.draw = function(n) {
    if (this.mixer.pics.length) {
        let item = this.mixer.pics.shift();
        let picBuffer = item.buffer;
        this.fps = this.fpsCalculator(this.mixer.pics.length);
        setTimeout(this.draw.bind(this), this.fps);
        this.drawMatchingInfo(item);
        this.display.drawNextOuptutPictureGL(this.width,this.height,null,picBuffer);
    }
    else {
        setTimeout(this.draw.bind(this), 10);
    }
}

Player.prototype.drawMatchingInfo = function(item) {
    // let ctx = document.getElementById("rectcanvas").getContext("2d");
    let ctx = this.matchingLayer.getContext("2d");
    ctx.clearRect(0,0,1920,1080);
    if (item.state == TS_STATE.FULL) {
        if (item.einfo) {
            ctx.beginPath();
            ctx.lineWidth = config.tracking.thickness;
            ctx.strokeStyle = config.tracking.color;
            for (c of item.einfo.rects) {
                let r = new Rect(c.x,c.y,c.width,c.height);
                let dr = scale(r,this.xrate,this.yrate);
                ctx.rect(dr.x,dr.y,dr.width,dr.height);
            }
            ctx.stroke();
            for (c of item.einfo.speeds) {
                ctx.font = "bolder 40px Arial";
                ctx.fillStyle = "green";
                // ctx.strokeStyle = 'black';
                // ctx.strokeText('Some text', 50, 50);
                // ctx.textAlign = "center";
                ctx.fillText(parseInt(c.value) + "km/h", c.x, c.y); 
            }
            // ctx.fill();
            // ctx.stroke();
        }
        if (!this.firstDraw) {
            console.log("draw croparea");
            this.firstDraw = true;
            // this.drawCropArea();
        }
    }
}
