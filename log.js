'use strict';

const inspector = require('schema-inspector'),
	fs = require('fs'),
	//RFC5424 + silly
	levels = {
		silent: 0,
		quiet: 0,
		emerg: 1,
		alert: 2,
		crit: 3,
		error: 4,
		warning: 5,
		notice: 6,
		info: 7,
		debug: 8,
		silly: 9
	},
	configSchema = {
		type: 'object',
		strict: true,
		properties: {
			strict: {
				type: 'boolean'
			},
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
					db: {
						type: 'string',
						pattern: /^mongodb:\/\/[A-Za-z0-9\.:]+\/[A-Za-z0-9\.]+/
					},
					safe: {type: 'boolean'}
				}
			}
		}
	};

let configuration = {
	strict: true,
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
		db: 'mongodb://localhost:27017/Logs',
		safe: true
	}
};

/*
	Fuse two object together, based on the first object schema.
	If the second object have a new value for the key of the same type,
	it will replace it.
*/
function fuse(base, change) {
	let c = {};

	if(!base) {
		return change;
	}

	if(!change) {
		return base;
	}

	Object.keys(base).map((key) => {
		if(typeof base[key] === 'object') {
			c[key] = fuse(base[key], change[key]);
		} else if(change && change[key]) {
			c[key] = change[key];
		} else {
			c[key] = base[key];
		}
	});
	return c;
}

/*
	Compare the saved configuration with the new one, and return the new
	configuration
*/
function compileConfig(config) {
	let c = fuse(configuration, config),
		results = inspector.validate(configSchema, c);
	// console.log(c);
	if(results.valid) {
		return c;
	} else {
		if(configuration.strict) {
			throw new Error(results.format());
		} else {
			return configuration;
		}
	}
}

/*
	Ensure that the file can be created by trying to create each folder that
	lead to it
*/
function createLogPath(logPath) {
	//Get folders to be created
	let folders = (logPath).split('/');
	folders.pop();

	//Build the paths to the folders
	folders.map((e, n, folders) => {
		let i = 0,
			path = '';

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
	loggers.map((logger) => {
		logger.configure(configuration);
	});
}

/*
	DEPENDENCY_
*/
const winston = require('winston');

//Return the transports that will be used by Winston for that configuration
function getTransports(file, config) {
	let transports = [];
	if(config.console.active) {
		let console = new (winston.transports.Console)({
			timestamp: true,
			prettyPrint: true,
			depth: null,
			level: config.console.level
		});
		transports.push(console);
	}
	if(config.file.active) {
		let file = new (winston.transports.File)({
			// filename: config.file.logpath + file,
			filename: config.file.logpath + 'all.log',
			timestamp: true
		});
		createLogPath(config.file.logpath, file);
		transports.push(file);
	}
	if(config.mongo.active) {
		require('winston-mongodb');
		let mongo = new (winston.transports.MongoDB)({
			timestamp: true,
			level: config.mongo.level,
			name: config.mongo.db + config.mongo.collection,
			safe: config.mongo.safe,
			collection: config.mongo.collection,
			db: config.mongo.db
		});
		// mongo.on('error', (error) => {
		// 	console.log('Error');
		// 	console.log(error);
		// });
		transports.push(mongo);
	}

	return transports;
}

//Transform the Logger constructor's input to a Winston compatible configuration
function getLoggerConfiguration(file, config) {
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

function getLogger(file, config) {
	return new winston.Logger(getLoggerConfiguration(file, config));
}
/*
	_DEPENDENCY
*/

/*
	Remember all created logger. Allow to reconfigure them all at the same time
	on Logger.configure
*/
let loggers = [];

const Logger = class Logger {
	constructor(file, conf) {
		if(
			!file ||
			typeof file !== 'string'
		) {
			file = '';
		}
		this.file = file;

		//Get the fusion between global config and local config
		let config = compileConfig(conf);

		this.config = config;

		let w = getLogger(file, config);
		this.logger = w;
		loggers.push(this);
	}

	configure(config) {
		let conf = compileConfig(config);

		this.config = conf;

		this.logger.configure(
			getLoggerConfiguration(
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

	silent() {}

	quiet() {}

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
Logger.reconfigure = configure;

module.exports = Logger;
