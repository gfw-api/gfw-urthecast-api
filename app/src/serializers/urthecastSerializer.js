'use strict';

var logger = require('logger');
var JSONAPISerializer = require('jsonapi-serializer').Serializer;
var urthecastSerializer = new JSONAPISerializer('urthecast', {

    attributes: ['cloud_coverage', 'owner_scene_id', 'owner', 'platform', 'satellite_id', 'sensor_platform', 'average_scene_altitude',
    'acquired', 'sun_elevation', 'solar_time_of_day_acquired', 'earth_sun_distance', 'season', 'sun_azimuth', 'tiled', 'scene_area', 'geometry', 'processed'],
    geometry:{
        attributes: ['type', 'coordinates']
    },
    typeForAttribute: function (attribute, record) {
        return attribute;
    },
    keyForAttribute: 'camelCase'
});

class UrthecastSerializer {

  static serialize(data) {
    return urthecastSerializer.serialize(data);
  }
}

module.exports = UrthecastSerializer;
