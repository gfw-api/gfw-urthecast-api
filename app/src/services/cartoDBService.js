'use strict';
var logger = require('logger');
var path = require('path');
var config = require('config');
var CartoDB = require('cartodb');
var Mustache = require('mustache');
var NotFound = require('errors/notFound');
var JSONAPIDeserializer = require('jsonapi-serializer').Deserializer;

const WORLD = `WITH poly AS (SELECT * FROM ST_SetSRID(ST_GeomFromGeoJSON('{{{geojson}}}'), 4326) geojson)
        SELECT data_type,
            SUM(ST_Area(ST_Intersection(ST_Transform(poly.geojson, 3857), i.the_geom_webmercator))/(100*100)) AS value
            {{additionalSelect}}
        FROM imazon_sad i, poly
        WHERE i.date >= '{{begin}}'::date
            AND i.date <= '{{end}}'::date
        GROUP BY data_type `;

const ISO = `SELECT data_type,
            sum(ST_Area(i.the_geom_webmercator)/(100*100)) AS value, 851600000 as area_ha
            {{additionalSelect}}
        FROM imazon_sad i
        WHERE i.date >= '{{begin}}'::date
            AND i.date <= '{{end}}'::date
        GROUP BY data_type `;

const ID1 = `with p as (SELECT the_geom_webmercator, (ST_Area(geography(the_geom))/10000) as area_ha FROM gadm2_provinces_simple WHERE iso = UPPER('{{iso}}') AND id_1 = {{id1}})
        SELECT data_type, SUM(ST_Area( ST_Intersection( i.the_geom_webmercator, p.the_geom_webmercator))/(10000)) AS value, area_ha
        FROM imazon_sad i right join p on st_intersects(i.the_geom_webmercator, p.the_geom_webmercator)
        and i.date >= '{{begin}}'::date
        AND i.date <= '{{end}}'::date
        GROUP BY data_type, area_ha`;

const USE = `SELECT data_type, SUM(ST_Area(ST_Intersection(
                i.the_geom_webmercator,
                p.the_geom_webmercator))/(10000)) AS value, area_ha
               {{additionalSelect}}
        FROM {{useTable}} p left join imazon_sad i
            on ST_Intersects(
                i.the_geom_webmercator,
                p.the_geom_webmercator)
            AND i.date >= '{{begin}}'::date
            AND i.date <= '{{end}}'::date
            where p.cartodb_id = {{pid}}
        GROUP BY data_type, area_ha `;

const WDPA = `WITH  p as ( SELECT
            CASE WHEN marine::numeric = 2
             THEN null
            WHEN ST_NPoints(the_geom_webmercator)<=18000 THEN the_geom_webmercator
            WHEN ST_NPoints(the_geom_webmercator)
            BETWEEN 18000 AND 50000
            THEN ST_RemoveRepeatedPoints(the_geom_webmercator, 100)
            ELSE ST_RemoveRepeatedPoints(the_geom_webmercator, 1000)
            END as the_geom_webmercator, gis_area*100 as area_ha FROM wdpa_protected_areas where wdpaid={{wdpaid}})
            SELECT data_type, SUM(ST_Area(ST_Intersection(
                            i.the_geom_webmercator,
                            p.the_geom_webmercator))/(10000)) AS value, area_ha
            {{additionalSelect}}
            FROM p
            left join imazon_sad i
            on st_intersects(i.the_geom_webmercator,
                            p.the_geom_webmercator)
            and i.date >= '{{begin}}'::date
                        AND i.date <= '{{end}}'::date
            GROUP BY data_type, area_ha`;

const LATEST = `SELECT DISTINCT date
        FROM imazon_sad
        WHERE date IS NOT NULL
        ORDER BY date DESC
        LIMIT {{limit}}`;

const MIN_MAX_DATE_SQL = ', MIN(date) as min_date, MAX(date) as max_date ';

var executeThunk = function(client, sql, params) {
    return function(callback) {
        logger.debug(Mustache.render(sql, params));
        client.execute(sql, params).done(function(data) {
            callback(null, data);
        }).error(function(err) {
            callback(err, null);
        });
    };
};

var deserializer = function(obj) {
    return function(callback) {
        new JSONAPIDeserializer({keyForAttribute: 'camelCase'}).deserialize(obj, callback);
    };
};


let getToday = function() {
    let today = new Date();
    return `${today.getFullYear().toString()}-${(today.getMonth()+1).toString()}-${today.getDate().toString()}`;
};

let getYesterday = function() {
    let yesterday = new Date(Date.now() - (24 * 60 * 60 * 1000));
    return `${yesterday.getFullYear().toString()}-${(yesterday.getMonth()+1).toString()}-${yesterday.getDate().toString()}`;
};


let defaultDate = function() {
    let to = getToday();
    let from = getYesterday();
    return from + ',' + to;
};

class CartoDBService {

    constructor() {
        this.client = new CartoDB.SQL({
            user: config.get('cartoDB.user')
        });
        this.apiUrl = config.get('cartoDB.apiUrl');
    }

    getDownloadUrls(query, params) {
        try {
            let formats = ['csv', 'geojson', 'kml', 'shp', 'svg'];
            let download = {};
            let queryFinal = Mustache.render(query, params);
            queryFinal = queryFinal.replace(MIN_MAX_DATE_SQL, '');
            queryFinal = queryFinal.replace('SELECT data_type,', 'SELECT i.data_type, i.the_geom,');
            queryFinal = queryFinal.replace('GROUP BY data_type', 'GROUP BY data_type, i.the_geom');
            queryFinal = encodeURIComponent(queryFinal);
            for (let i = 0, length = formats.length; i < length; i++) {
                download[formats[i]] = this.apiUrl + '?q=' + queryFinal + '&format=' + formats[i];
            }
            return download;
        } catch (err) {
            logger.error(err);
        }
    }


    *
    getNational(iso, alertQuery, period = defaultDate()) {
        logger.debug('Obtaining national of iso %s', iso);
        let periods = period.split(',');
        let params = {
            iso: iso,
            begin: periods[0],
            end: periods[1]
        };
        if (alertQuery) {
            params.additionalSelect = MIN_MAX_DATE_SQL;
        }
        if (iso === 'BRA') {
            let data = yield executeThunk(this.client, ISO, params);
            if (data.rows) {
                let result = {
                    value: data.rows
                };
                if(data.rows.length > 0){
                    result.area_ha = data.rows[0].area_ha;
                }
                result.downloadUrls = this.getDownloadUrls(ISO, params);
                return result;
            }
        } else {
            return {
                value: []
            };
        }
        return null;
    }

    *
    getSubnational(iso, id1, alertQuery, period = defaultDate()) {
        logger.debug('Obtaining subnational of iso %s and id1', iso, id1);
        let periods = period.split(',');
        let params = {
            iso: iso,
            id1: id1,
            begin: periods[0],
            end: periods[1]
        };
        if (alertQuery) {
            params.additionalSelect = MIN_MAX_DATE_SQL;
        }
        if (iso === 'BRA') {
            let data = yield executeThunk(this.client, ID1, params);
            if (data.rows) {
                let result = {
                    value: data.rows
                };
                if(data.rows.length > 0){
                    result.area_ha = data.rows[0].area_ha;
                }
                result.downloadUrls = this.getDownloadUrls(ISO, params);
                return result;
            }
        } else {
            return {
                value: []
            };
        }
        return null;
    }

    *
    getUse(useTable, id, alertQuery, period = defaultDate()) {
        logger.debug('Obtaining use with id %s', id);
        let periods = period.split(',');
        let params = {
            useTable: useTable,
            pid: id,
            begin: periods[0],
            end: periods[1]
        };
        if (alertQuery) {
            params.additionalSelect = MIN_MAX_DATE_SQL;
        }
        let data = yield executeThunk(this.client, USE, params);

        if (data.rows) {
            let result = {
                value: data.rows
            };
            if(data.rows.length > 0){
                result.area_ha = data.rows[0].area_ha;
            }
            result.downloadUrls = this.getDownloadUrls(ISO, params);
            return result;
        }
        return null;
    }

    *
    getWdpa(wdpaid, alertQuery, period = defaultDate()) {
        logger.debug('Obtaining wpda of id %s', wdpaid);
        let periods = period.split(',');
        let params = {
            wdpaid: wdpaid,
            begin: periods[0],
            end: periods[1]
        };
        if (alertQuery) {
            params.additionalSelect = MIN_MAX_DATE_SQL;
        }
        let data = yield executeThunk(this.client, WDPA, params);
        if (data.rows) {
            let result = {
                value: data.rows
            };
            if(data.rows.length > 0){
                result.area_ha = data.rows[0].area_ha;
            }
            result.downloadUrls = this.getDownloadUrls(ISO, params);
            return result;
        }
        return null;
    }

    *
    getGeostore(hashGeoStore) {
        logger.debug('Obtaining geostore with hash %s', hashGeoStore);
        let result = yield require('vizz.microservice-client').requestToMicroservice({
            uri: '/geostore/' + hashGeoStore,
            method: 'GET',
            json: true
        });
        if (result.statusCode !== 200) {
            console.error('Error obtaining geostore:');
            console.error(result);
            return null;
        }
        return yield deserializer(result.body);
    }

    *
    getWorld(hashGeoStore, alertQuery, period = defaultDate()) {
        logger.debug('Obtaining world with hashGeoStore %s', hashGeoStore);

        let geostore = yield this.getGeostore(hashGeoStore);
        if (geostore && geostore.geojson) {
            logger.debug('Executing query in cartodb with geostore', geostore);
            let periods = period.split(',');
            let params = {
                geojson: JSON.stringify(geostore.geojson.features[0].geometry),
                begin: periods[0],
                end: periods[1]
            };
            if (alertQuery) {
                params.additionalSelect = MIN_MAX_DATE_SQL;
            }
            let data = yield executeThunk(this.client, WORLD, params);
            if (data.rows) {
                let result = {
                    value: data.rows,
                    area_ha: geostore.areaHa
                };
                result.downloadUrls = this.getDownloadUrls(ISO, params);
                return result;
            }
            return null;
        }
        throw new NotFound('Geostore not found');
    }

    *
    latest(limit = 3) {
        logger.debug('Obtaining latest with limit %s', limit);
        let params = {
            limit: limit
        };
        let data = yield executeThunk(this.client, LATEST, params);
        logger.debug('data', data);
        if (data.rows) {
            let result = data.rows;
            return result;
        }
        return null;
    }
}

module.exports = new CartoDBService();
