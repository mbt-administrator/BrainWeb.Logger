'use strict';

const winston = require('winston'),
	inspector = require('schema-inspector'),
	fs = require('fs'),
	//RFC5424 + silly
	levels = {
		emerg: 0,
		alert: 1,
		crit: 2,
		error: 3,
		warning: 4,
		notice: 5,
		info: 6,
		debug: 7,
		silly: 8
	},
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
		level: 'debug',
		logpath: './logs/'
	},
	mongo: {
		active: false,
		level: 'debug',
		db: 'mongo://localhost:27017/',
		safe: true
	}
};

winston.setLevels(levels);

/*
	Fuse two object together, based on the first object schema.
	If the second object have a new value for the key of the same type,
	it will replace it.
*/
function fuse(a, b) {
	// log.silly('fuse', {a, b});
	//console.log('fuse: \na:' + a + '\nb: ' + b);
	let c = {};

	Object.keys(a).map((key) => {
		if(typeof a[key] === 'object') {
			c[key] = fuse(a[key], b[key]);
		} else if(b && b[key] && typeof a[key] === typeof b[key]) {
			c[key] = b[key];
		} else {
			c[key] = a[key];
		}
	});
	// log.silly('fuse', {c});
	//console.log('fuse: \nc:' + c);
	return c;
}

function compileConfig(config) {
	let c = fuse(configuration, config);
	if(inspector.validate(configSchema, c)) {
		return c;
	} else {
		return configuration;
	}
}

function createLogPath(logPath, file) {
	//Get folders to be created
	let folders = file.split('/');
	folders.pop();

	//Build the paths to the folders
	folders.map((e, n, folders) => {
		let i = 0,
			path = 0;

		while(i <= n) {
			path = path + folders[i] + '/';
			i = i + 1;
		}
		return path;
	})
	//Create the paths
	.forEach((folder) => {
		try {
			fs.mkdirSync(folder);
		} catch (error) {
			//Ignore Already Exist errors
			if(error.code !== 'EEXIST') {
				throw(error);
			}
		}
	});
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
