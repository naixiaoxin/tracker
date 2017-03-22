var mongoose = require('mongoose');
var onFinished = require('on-finished');
var URL = require('url');

var Schema = mongoose.Schema;

mongoose.Promise = global.Promise;

var logSchema = new Schema({
    log : String,
    time: { type: Date, index: true }
});

var requestSchema = new Schema({
    status   : { type: Number, index: true },
    url      : { type: String, index: true },
    method   : String,
    content  : String,
    time     : { type: Number, index: true },
    startTime: { type: Date, index: true },
    endTime  : { type: Date, index: true },
    tracker  : { type: Schema.Types.ObjectId, ref: 'Tracker', index: true },
    body     : Object
}, {
    timestamps: true
});
requestSchema.path('createdAt').expires('7d');

var trackerSchema = new Schema({
    url      : { type: String, index: true },
    host     : { type: String, index: true },
    pathname : { type: String, index: true },
    search   : { type: String, index: true },
    appId    : { type: Number, index: true },
    hash     : String,
    query    : Object,
    logs     : [ logSchema ],
    time     : { type: Number, index: true },
    startTime: { type: Date, index: true, default: Date.now },
    endTime  : { type: Date, index: true },
    status   : { type: Number, index: true },
    method   : String,
    body     : Object,
    requests : [ { type: Schema.Types.ObjectId, ref: 'Request', index: true } ]
}, {
    timestamps: true
});

trackerSchema.path('createdAt').expires('7d');

trackerSchema.methods.track = function (log) {
    this.logs.push({
        log : log,
        time: Date.now()
    });
};

trackerSchema.methods.request = function (url, method, body, promise) {
    var st = Date.now();
    method = method || 'GET';
    this.track('api request ' + method + ' ' + url);
    var _this = this
    promise.then(function (data) {
        var text = data.text,
            response = data.response;
        var request = new Request({
            status   : response.status,
            url      : url,
            method   : method,
            content  : text,
            startTime: st,
            endTime  : Date.now(),
            time     : Date.now() - st,
            tracker  : _this._id,
            body     : body
        });
        request.save();
        _this.requests.push(request._id);
        _this.track('api end success ' + method + ' ' + url);
    }, function (err) {
        var request = new Request({
            status   : err.status,
            url      : url,
            method   : method,
            content  : err,
            startTime: st,
            endTime  : Date.now(),
            time     : Date.now() - st,
            tracker  : _this._id,
            body     : err.body
        });
        request.save();
        _this.requests.push(request._id);
        _this.track(`api end error ${method} ${url}`);
    })
    this.requestPromises.push(promise);
    return promise;
};

trackerSchema.methods.end = function (status) {
    this.endTime = Date.now();
    this.time = this.endTime - this.startTime;
    this.status = status;
    this.track('request end');
    this.save();
    var _this = this
    Promise.all(_this.requestPromises).then(function () {
        _this.track('done');
        _this.save();
    }).catch(function (err) {
        _this.track('There has some requests error!');
        _this.save();
    });
};

trackerSchema.methods.start = function (appId, url, method, body) {
    this.appId = appId;
    this.url = url;
    this.method = method;
    this.body = body;
    this.requestPromises = [];
    this.track('request start');
    var urlObj = URL.parse(this.url, true);
    Object.assign(this, urlObj);
};

trackerSchema.statics.start = function (uri) {
    return mongoose.connect(uri, console.log);
};

trackerSchema.statics.express = function (options) {
    this.start(options.uri);
    var _this = this;
    return function (req, res, next) {
        if (mongoose.connection.readyState !== 1) return next();
        var fullUrl = req.protocol + '://' + req.get('host') + req.originalUrl;
        var appId = (res.locals.info && res.locals.info.appId) || null;

        if (options.appIds && options.appIds instanceof Array && options.appIds.indexOf(appId) !== -1) {
            req.tracker = new _this();
            req.tracker.start(appId, fullUrl, req.method, req.body);
            /* eslint-disable */
            res.locals.tracker = req.tracker._id;
            /* eslint-ensable */
            onFinished(res, function (err, response) {
                req.tracker.end(response.statusCode);
            });
            next();
        } else {
            next();
        }
    }
};

var Request = mongoose.model('Request', requestSchema);

var Tracker = mongoose.model('Tracker', trackerSchema);

Tracker.Request = Request;

module.exports = Tracker;
