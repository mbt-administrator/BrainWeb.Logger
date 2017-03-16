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

/*
	Fuse two object together, based on the first object schema.
	If the second object have a new value for the key of the same type,
	it will replace it.
*/
function fuse(a, b) {
	// log.silly('fuse', {a, b});
	// console.log('fuse: \na:' + require('util').inspect(a) + '\nb:' + require('util').inspect(b));
	let c = {};

	if(!a) {
		return b;
	}

	if(!b) {
		return a;
	}

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
	// console.log('fuse: \nc:' + require('util').inspect(c));
	return c;
}

/*
	Compare the saved configuration with the new one, and return the new
	configuration
*/
function compileConfig(config) {
	let c = fuse(configuration, config);
	if(inspector.validate(configSchema, c)) {
		return c;
	} else {
		return configuration;
	}
}

/*
	Ensure that the file can be created by trying to create each folder that 
	lead to it
*/
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

//Logger.configure
//Reconfigure every logger created
function configure(config) {
	configuration = compileConfig(config);
	// console.log('configure: ' + require('util').inspect(configuration));
	loggers.map((logger) => {
		logger.configure(configuration);
	});
}

//Return the transports that will be used by Winston for that configuration
function getTransports(file, config) {
	let transports = [];
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

	return transports;
}

//Transform the Logger constructor's input to a Winston compatible configuration
function getWinstonConfiguration(file, config) {
	return {
		levels,
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
		transports: getTransports(file, config)
	};
}

/*
	Remember all created logger. Allow to reconfigure them all at the same time
	on Logger.configure
*/
let loggers = [];

let Logger = class Logger {
	constructor(file, conf) {
		this.file = file;

		//Get the fusion between global config and local config
		let config = compileConfig(conf);

		this.config = config;
		//console.log('log:' + JSON.stringify({file, config}));

		let w = new winston.Logger(getWinstonConfiguration(file, config));
		this.logger = w;
		loggers.push(this);
	}

	configure(config) {
		let conf = compileConfig(config);

		this.config = conf;

		this.logger.configure(
			getWinstonConfiguration(
				this.file,
				conf
			)
		);
	}

	getConfiguration() {
		return this.config;
	}

	unlink() {
		loggers.splice(loggers.indexOf(this.logger));
	}

	emerg(...args) {
		this.logger.emerg(...args);
	}

	alert(...args) {
		this.logger.alert(...args);
	}

	crit(...args) {
		this.logger.crit(...args);
	}

	error(...args) {
		this.logger.error(...args);
	}

	warning(...args) {
		this.logger.warning(...args);
	}

	notice(...args) {
		this.logger.notice(...args);
	}

	info(...args) {
		this.logger.info(...args);
	}

	debug(...args) {
		this.logger.debug(...args);
	}

	silly(...args) {
		this.logger.silly(...args);
	}
};

Logger.configure = configure;
module.exports = Logger;
