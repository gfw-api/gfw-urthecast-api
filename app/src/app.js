'use strict';
//load modules
var config = require('config');
var logger = require('logger');
var path = require('path');
var koa = require('koa');
var bodyParser = require('koa-bodyparser');
var koaLogger = require('koa-logger');
var loader = require('loader');
var ErrorSerializer = require('serializers/errorSerializer');

// instance of koa
var app = koa();


app.use(bodyParser({
    jsonLimit: '50mb'
}));

//catch errors and send in jsonapi standard. Always return vnd.api+json
app.use(function*(next) {
    try {
        yield next;
    } catch (err) {
        logger.error('Error', err);
        this.status = err.status || 500;
        this.body = ErrorSerializer.serializeError(this.status, err.message);
        if (process.env.NODE_ENV === 'prod' && this.status === 500) {
            this.body = 'Unexpected error';
        }
    }
    // this.response.type = 'application/vnd.api+json';
});


//load routes
loader.loadRoutes(app);

//Instance of http module
var server = require('http').Server(app.callback());

// get port of environment, if not exist obtain of the config.
// In production environment, the port must be declared in environment variable
var port = process.env.PORT || config.get('service.port');

server.listen(port, function() {
    require('vizz.microservice-client').register({
        id: config.get('service.id'),
        name: config.get('service.name'),
        dirConfig: path.join(__dirname, '../microservice'),
        dirPackage: path.join(__dirname, '../../'),
        logger: logger,
        app: app
    });
    
});

logger.info('Server started in port:' + port);
