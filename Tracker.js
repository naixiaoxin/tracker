const mongoose = require('mongoose')
const onFinished = require('on-finished')
const URL = require('url')

const { Schema } = mongoose

mongoose.Promise = global.Promise

const logSchema = new Schema({
    log : String,
    time: { type: Date, index: true },
})

const requestSchema = new Schema({
    status   : { type: Number, index: true },
    url      : { type: String, index: true },
    method   : String,
    content  : String,
    time     : { type: Number, index: true },
    startTime: { type: Date, index: true },
    endTime  : { type: Date, index: true },
    body     : Object
})

const trackerSchema = new Schema({
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
})

trackerSchema.path('createdAt').expires('7d')

trackerSchema.methods.track = function (log) {
    this.logs.push({
        log,
        time: Date.now()
    })
}

trackerSchema.methods.request = function (url, method, body, promise) {
    const st = Date.now()
    method = method || 'GET'
    this.track(`api request ${method} ${url}`)
    promise.then(({ text, response }) => {
        const request = new Request({
            status   : response.status,
            url,
            method,
            content  : text,
            startTime: st,
            endTime  : Date.now(),
            time     : Date.now() - st,
            body
        })
        request.save()
        this.requests.push(request._id)
        this.track(`api end success ${method} ${url}`)
    }, err => {
        const request = new Request({
            status   : err.status,
            url,
            method,
            content  : err,
            startTime: st,
            endTime  : Date.now(),
            time     : Date.now() - st,
            body     : err.body
        })
        request.save()
        this.requests.push(request)
        this.track(`api end error ${method} ${url}`)
    })
    this.requestPromises.push(promise)
    return promise
}

trackerSchema.methods.end = function (status) {
    this.endTime = Date.now()
    this.time = this.endTime - this.startTime
    this.status = status
    this.track('request end')
    this.save()
    Promise.all(this.requestPromises).then(() => {
        this.track('done')
        this.save()
    }).catch((err) => {
        this.track('There has some requests error!')
        this.save()
    })
}

trackerSchema.statics.start = (uri) => mongoose.connect(uri)

trackerSchema.statics.express = function (options) {
    this.start(options.uri)
    return (req, res, next) => {
        const fullUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`
        const appId = (res.locals.info && res.locals.info.appId) || null
        req.tracker = new this(appId, fullUrl, req.method, req.body)
        /* eslint-disable */
        res.locals.tracker = req.tracker._id
        /* eslint-ensable */
        onFinished(res, (err, response) => {
            req.tracker.end(response.statusCode)
        })
        next()
    }
}

const Request = mongoose.model('Request', requestSchema)

const Model = mongoose.model('Tracker', trackerSchema)

class Tracker extends Model {
    constructor(appId, url, method, body) {
        super({
            appId,
            url,
            method,
            body
        })
        this.requestPromises = []
        this.track('request start')
        const urlObj = URL.parse(this.url, true)
        Object.assign(this, urlObj)
    }
}

Tracker.Request = Request

module.exports = Tracker
