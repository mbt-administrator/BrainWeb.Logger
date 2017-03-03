'use strict';

const winston = require('winston'),
	inspector = require('schema-inspector'),
	utils = require('blad-utils'),
	configSchema = {
		type: 'object',
		strict: true,
		properties: {
			console: {
				type: 'object',
				properties: {
					active: {type: 'boolean'},
					level: {
						type: 'string',
						eq: ['silly', 'debug', 'info', 'error', 'fatal']
					}
				}
			},
			file: {
				type: 'object',
				properties: {
					active: {type: 'boolean'},
					level: {
						type: 'string',
						eq: ['silly', 'debug', 'info', 'error', 'fatal']
					},
					logpath: {
						type: 'string',
						/*
							Is a relative or absolute directory path:
							foo => false
							foo/ => false
							/foo => false
							/foo/ => true
							./foo/ => true
							./foo/bar/ => true
						*/
						pattern: /^\.?\/([a-zA-Z0-9\.]*\/)*$/,
						optionnal: true
					}
				}
			},
			mongo: {
				type: 'object',
				properties: {
					active: {type: 'boolean'},
					level: {
						type: 'string',
						eq: ['silly', 'debug', 'info', 'error', 'fatal']
					},
					db: {type: 'string'},
					safe: {type: 'boolean'}
				}
			}
		}
	};

let configuration = {
	console: {
		active: true,
		level: 'info'
	},
	file: {
		active: false,
		level: 'true',
		logpath: './logs/'
	},
	mongo: {
		active: false,
		level: 'debug',
		db: 'mongo://localhost:27017/',
		safe: true
	}
};

function compileConfig(config) {
	let c = utils.fuse(configuration, config);
	if(inspector.validate(configSchema, c)) {
		return c;
	} else {
		return configuration;
	}
}

function init(config) {
	configuration = compileConfig(config);
}

let Logger = class Logger {
	constructor(file, conf) {
		//Get the fusion between global config and local config
		let config = compileConfig(configuration, conf),
			transports = [];

		//console.log('log:' + JSON.stringify({file, config}));

		if(config.console.active) {
			transports.push(new (winston.transports.Console)({
				timestamp: true,
				prettyPrint: true,
				depth: null,
				level: config.console.level
			}));
		}
		if(config.file.active) {
			createLogPath(config.logpath, file);
			transports.push(new (winston.transports.File)({
				filename: config.logpath + file,
				timestamp: true
			}));
		}
		if(config.mongo.active) {
			require('winston-mongodb');
			transports.push(new (winston.transports.MongoDB)({
				timestamp: true,
				level: config.mongo.level,
				name: config.mongo.db + config.mongo.collection,
				safe: config.mongo.safe,
				collection: config.mongo.collection,
				db: config.mongo.db
			}));
		}
		return new winston.Logger({
			rewriters: [
				(level, message, meta) => {
					if(meta && meta.error instanceof Error) {
						meta.error = {
							name: meta.error.name,
							message: meta.error.message,
							stack: meta.error.stack
						};
					}
					return meta;
				},
				(level, message, meta) => {
					meta.app = file;
					return meta;
				}
			],
			transports: transports
		});
	}
};

Logger.init = init;
module.exports = Logger;
