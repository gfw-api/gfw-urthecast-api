'use strict';

var Router = require('koa-router');
var logger = require('logger');
var NotFound = require('errors/notFound');
var request = require('request');
var coRequest = require('co-request');
var config = require('config');
var servers = config.get('urthecast.servers');
var UrthecastSerializer = require('serializers/urthecastSerializer');

var router = new Router({
    prefix: '/urthecast'
});

class UrthecastRouter {

    static * getMapTiles() {
        logger.info('Obtaining tile');
        logger.debug(this.url);
        var baseUrl = config.get('urthecast.tileUrl');
        var key = config.get('urthecast.key');
        var secret = config.get('urthecast.secret');
        let server = servers[Math.floor(Math.random() * servers.length)];
        var query = this.url.replace('urthecast/map-tiles/', '');

        var finalUrl = `${baseUrl.replace('{server}', server)}${query}&api_key=${key}&api_secret=${secret}`;
        this.body = request(finalUrl);

    }

    static * archiveScenes(){
        logger.info('Getting archice scenes');
        var baseUrl = config.get('urthecast.apiUrl');
        var key = config.get('urthecast.key');
        var secret = config.get('urthecast.secret');

        try{
            let url = `${baseUrl}?${this.request.search}&api_key=${key}&api_secret=${secret}`;
            let result = yield coRequest({
                uri: url,
                method: 'GET',
                json: true
            });
            if(result.statusCode === 200){
                this.body = UrthecastSerializer.serialize(result.body.payload);
                this.response.type = 'application/vnd.api+json';
            } else {
                this.throw(result.statusCode, result.body);
            }
        }catch(err){
            throw err;
        }
    }

}

router.get('/map-tiles/:renderer/:z/:x/:y', UrthecastRouter.getMapTiles);
router.get('/archive/scenes', UrthecastRouter.archiveScenes);

module.exports = router;
