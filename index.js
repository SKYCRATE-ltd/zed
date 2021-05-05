import {
	extend, iterate, entries,
	map, filter, concat,
	copy, pop, has,
	create, apply, define,
	sort, o, is,
	Getter, Accessor, view
} from "crux";

const AT = '@';
const DO_NOTHING = x => x;
const satisfies = (T1, T2) =>
	T1 === T2 || (T1.parents && T1.parents.length ?
		T1.parents.some(t => satisfies(t, T2)) :
			T1.__proto__ && T1.__proto__ !== Object.__proto__ ?
				satisfies(T1.__proto__, T2) : false);

const DEFAULT_PROTOTYPE = {
	// Should these be made differnetly? Might change to __method__ to avoid collisions...
	// OR, I wrap objects... not sure yet...
	// Modify(obj).map(x => ...).filter(x => ...).etc...
	extend(...objects) {
		return extend(this, ...objects);
	},
	assign(values) {
		return apply(this, values);
	},
	concat(...objects) {
		return concat(this, ...objects);
	},
	map(mapper) {
		return map(this, mapper);
	},
	filter(filterer) {
		return filter(this, filterer);
	},
	forEach(iterator) {
		return iterate(this, iterator);
	},
	copy() {
		return copy(this);
	},
	
	/* The following might need modified... */
	define(props) {
		return define(this, props);
	},
	static(props, enumerable = true) {
		return this.define(create.values(props, enumerable));
	},
	fields(fields) {
		const [
			props = {},
			proto = {},
			defs = {}
		] = parse(fields, this.constructor.parents);
		return this
			.static(proto)
			.define(props.map(([key, Descriptor]) => [key, Descriptor(key)]))
			.assign(defs);
	},

	super(Type, ...args) {
		if (args.length > 0) {
			if (this.constructor.parents.indexOf(Type) > -1)
				// TODO: for parents that are classes... how should we handle
				// calling the constructor for inheritance? We seem to be stuck
				// with the "new" keyword.
				return Type.apply(this, args) || this;
			throw `INIT ERROR: ${Type.name} not in inheritence chain.`;
		}

		return view(Type.prototype).map(([key, value]) => [key, value.bind(this)]);
	},
}

extend(Object.prototype, DEFAULT_PROTOTYPE);

const META_PROTOTYPE = {
	defines(instance) {
		return satisfies(instance.constructor, this);
	},
	validate(string) {
		return this.defines(string);
	},
	extends(Type, parents = this.parents) {
		return parents.some(parent => parent === Type || parent.extends(Type));
	},
	parse(string) {
		return new this(string);
	},
	stringify(instance) {
		return `${instance}`;
	}
};

const DEFAULT_PROPERTIES = {
	[Symbol.species]: Getter(obj => obj.constructor, false),
	[Symbol.toStringTag]: Getter(obj => {
		return is.constructable(obj) ? "" : `${typeof obj} ${obj.constructor.constructor.name}`;
	}, false),
};

const assemble = {
	constructor: (id, properties, prototype, applier) => {
		const constructor = {
			[id]: function(...args) {
				return applier(
					is.global(this) ?
						create(properties, {...prototype, constructor}) : this.define(properties),
					...args
				);
			}
		}[id];
		return constructor;
	},
	function: (id, properties, prototype, applier) => {
		const constructor = {
			[id](...args) {
				const instance = {
					[id](...args) {
						return func(...args);
					}
				}[id]
				.define(properties)
				.static({...prototype, constructor});
				const func = applier(instance, ...args);
				return instance;
			}
		}[id];
		return constructor;
	},
	class: (id, properties, prototype, applier, _BASE = Object) => {
		const Class = {
			[id]:
			class extends _BASE {
				constructor(...args) {
					super(...args);
					this.define(properties);
					applier(this, ...args);
				}
			}
		}[id];
		return Class;
	}
};

const format = {
	abstract: id => {
		const Abstract = {
			[id]: class {
				constructor() {
					if (this.constructor === Abstract)
						throw `Cannot create instance of an abstract => ${Abstract}. Please inherit or extend.`
				}
			}
		}[id];
		return Abstract;
	},
	model: (id, properties = o(), prototype = o(), _defaults = o()) =>
		assemble.constructor(
			id, properties, prototype,
			prototype.init ?
				(obj, ...args) =>
					is.either(prototype.init.apply(apply(obj, _defaults), args), obj) :
				(obj, defaults = o()) =>
					apply(obj, concat(_defaults, defaults))),
	procedure: (id, properties = o(), prototype = o(), _defaults = o()) =>
			assemble.function(
				id, properties, prototype,
				prototype.init ?
					(obj, ...args) => prototype.init.apply(apply(obj, _defaults), args) :
						(obj, func) => func.bind(obj)),
	class: (_base = Object) =>
		(id, properties = o(), prototype = o(), _defaults = o()) =>
			assemble.class(
				id, properties, prototype,
				(obj, ...args) => {
					apply(obj, concat(_defaults, obj.constructor.defaults));
					if (prototype.init)
						prototype.init.apply(obj, args);
				},
				_base),
};

export let Property = class {
	static [Symbol.hasInstance](instance) {
		return false;
	}
};

export const parse = (descriptor, parents = []) => {
	if (!descriptor)
		return [];

	const PROPERTY = 0, METHOD = 1, DEFAULT = 2, LISTENER = 3;

	return sort(descriptor, (key, value) => {
		if (is.constructable(value))
			return [PROPERTY, Field(value)];

		if (is.literal(value)) {
			if (is.object(value))
				return [PROPERTY, Field(Interface(`${key}`, value))];
			
			if (parents.some(parent => has(parent.properties, key)))
				return [DEFAULT, value];
			
			return [PROPERTY, Field(value.constructor).assign(value)];
		}

		if (is.function(value))
			return key.startsWith(AT) ?
					[
						LISTENER,
						[value]
					] :
					[
						value instanceof Property ?
							PROPERTY : METHOD,
						value
					];
		
		return [-1];
	}, [[], [], []]);
};

export const TypeDescriptor = (
	type,
	prototype = META_PROTOTYPE,
	properties = DEFAULT_PROPERTIES,
	defaults = o(),
	parents = [],
	listeners = {},
	statics = o(),
	constructor = Type
) => {
	if (constructor)
		type.static({constructor});
	if (type.prototype)
		type.prototype.static({...prototype}); // This should do what we need...
	else
		type.static({prototype});
	return type
	.define(DEFAULT_PROPERTIES)
	.static({
		defaults,
		parents,
		listeners
	}.extend(!type.properties ? {properties} : {}))
	.static(META_PROTOTYPE.filter(([key]) => !type[key]))
	.define({
		[Symbol.hasInstance]: create.value(function(instance) {
			return is.string(instance) ? this.validate(instance) : this.defines(instance);
		})
	})
	.static(statics);
};

export function Type(...args) {
	if (is.global(this)) {
		if (!is.string(args[0]))
			return Type('Type', format.model, ...args).call(this);

		let [id, formatter, ...descriptors] = args;
		let [descriptor = {}, ...parents] = pop(descriptors);

		if (is.constructable(descriptor))
			parents.push(descriptor) && (descriptor = null);

		let [
			properties = {},
			prototype = {},
			defaults = {},
			listeners = {} // {key -> [function]}
		] = parse(descriptor, parents);

		properties = concat(
			DEFAULT_PROPERTIES,
			...parents.map(parent => parent.properties || {}),
			properties.map(([key, Prop]) => [key, Prop(key)])
		);
			
		prototype = concat(
			...parents.map(parent => view(parent.prototype)),
			prototype);

		defaults = concat(
			...parents.map(parent => parent.defaults || {}),
			defaults);
		
		listeners = parents
					.map(parent => parent.listeners || {})
					.concat(listeners.map(([key, listener]) => [key.substr(AT.length), listener]))
					.reduce((result, obj) => {
						obj.forEach(([key, funclist]) => {
							const list = result[key];
							if (list)
								list.concat(funclist);
							else
								result[key] = [...funclist];
						});
						return result;
					}, {});

		return TypeDescriptor(
			formatter(
				id,
				properties,
				prototype,
				properties
					.filter(([key, prop]) => is.defined(prop._value))
					.map(([key, prop]) => [key, prop._value])
					.concat(defaults),
				listeners
			),
			prototype,
			properties,
			defaults,
			parents,
			listeners
		);
	}

	return this.fields(...args);
};
TypeDescriptor(Type).static({
	defines(instance) {
		return !!instance.prototype;
	}
});

export const Typify = (type, statics = o()) =>
	TypeDescriptor(type, {}, {}, {}, [], {}, statics, null);

Typify(String);
Typify(Number, {
	expression: /^(\+|-)?[0-9]+\.([0-9]+)?$/,
	defines(instance) {
		return instance instanceof Number;
	},
	parse(string) {
		const num = parseFloat(string);
		if (num === NaN)
			throw `!${this.name.toLocaleUpperCase()} PARSE ERROR! "${string}" is not a Number.`
		return num;
	},

	Range(a, b) {
		const type = this;
		const id = `Range<${type.name}>`;
		return {
			[id]: class extends type {
				static defines(instance) {
					return type.defines(instance) && instance >= a && instance <= b;
				}
			}
		}[id];
	}
});
Typify(Boolean, {
	validate(string) {
		return /^(true|false)$/.test(string);
	},
	parse(string) {
		return string === "true";
	}
});
Typify(BigInt);
Typify(Function, {
	parse(string) {
		try {
			return eval(`(${string})`);
		} catch(e) {
			throw `!FUNCTION PARSE ERROR! The string passed is not valid source code.`;
		}
	},
	stringify(func) {
		return func.toString();
	}
});
Typify(Date, {
	validate(string) {
		return /[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z/.test(string);
	},
	parse(string) {
		const d = new Date(string);
		if (isNaN(d))
			throw `!DATE PARSE ERROR! The string "${string}" is not a valid date format.`;
	},
	stringify(date) {
		return new Date(date.getTime() - (date.getTimezoneOffset() * 60000)).toJSON();
	}
});

export const Interface = Type('Interface', format.model, {
	init(_id, ...descriptors) {
		return Type(_id, format.abstract, ...descriptors).static({
			defines(instance) {
				if (entries(this.properties).every(([key, descriptor]) =>
					instance[key] instanceof descriptor.type));
			}
		});
	}
});

// TODO: change to just a function? The multi-level Type returning gets confusing...
export const MetaType = Type('MetaType', format.model, {
	init(_id, formatter) {
		const metatype = Type(_id, format.model, {
			
			init(id, ...descriptors) {
				if (!is.string(id))
					descriptors.unshift(id) && (id = _id);
				
				return Type(id, formatter, ...descriptors).static({
					constructor: metatype
				});
			}

		}).static({
			constructor: MetaType
		});
		return metatype;
	}
});
export const Abstract = MetaType('Abstract', format.abstract);
export const Model = MetaType('Model', format.model);
export const Procedure = MetaType('Procedure', format.procedure);
export const Class = Type('Class', format.model, {
	init(base, ...rest) {
		rest = rest.filter(descriptor => is.constructable(descriptor));
		return Type(
			base.name + (rest.length ? ' > ' + rest.join(' + ') : ''),
			format.class(base), ...rest);
	}
});
export const List = Type('List', format.model, {
	init(T) {
		return Type(
			`${T}[]`,
			format.class(Array),
			{
				init() {
					if (!this.every(item => item instanceof T))
						throw `LIST TYPE ERROR: All items must be of type ${T}`;
				}
			}
		).static({
			defines(array) {
				return array.every(item => item instanceof T);
			},
			parse(string) {
				return string
					.split(',')
					.map(x => x.trim())
					.filter(x => x)
					.map(x => T.parse(x));
			},
			stringify(rry) {
				return rry.map(x => T.stringify(x)).join(',');
			}
		});
	}
});

Property = Model(
	'Property',
	{
		init(
			key = 'anonymous',
			get = (obj, key) => undefined,
			set = (obj, key, value) => undefined,
		) {
			this.static(Accessor(
				obj => get(obj, key),
				(obj, to, from) => {
					if (this.validate(to))
						return set(obj, key, to, from);
					throw '!TYPE ERROR! @ ' +
						`${obj.constructor.name}.${key}:${this.type.name}${this._nullable ? '?' : ''}\n` +
						`"${to}" is of type ${is.defined(to) ? to.constructor.name : 'null'}.`;
				},
				// enumerable?
				key.constructor !== Symbol && !key.startsWith('_')
			));
		},
		validate(value) {
			return (value === null && this._nullable) || value instanceof this.type;
		},
		nullable(bool = true) {
			this._nullable = bool;
			this._required = false;
			return this;
		},
		assign(value = null) {
			if (!this.validate(value))
				throw '!TYPE ERROR! @ ' +
				`!ASSIGN ERROR! Value must be of type ${this.type.name}${this._nullable ? ' or null' : ''}.\n` +
				`"${value}" is of type ${is.defined(value) ? value.constructor.name : 'null'}.`;
			this._value = value;
			this._required = false;
			return this;
		},
		required(boolean = true) {
			this._required = boolean;
			this._value = undefined;
			return this;
		}
	}
);

export const Field = Procedure(
	'Field',
	Property,
	{
		init(type, onchange = DO_NOTHING) {
			this.type = type;
			return name => {
				this.super(
					Property,
					name,
					(obj, key) => this._value,
					(obj, key, to, from) =>
						setTimeout(() => onchange(obj, to, from), 15) && to
				);
				return this;
			}
		}
	});

export class Any extends Type {
	constructor() {
		throw `Cannot construct instance of type ${this.constructor.name}.`;
	}
	static defines() {
		return true;
	}
}

export class UInt extends Class(Number) {
	static expression = /^[0-9]+$/;
	constructor(...args) {
		super(...args);
	}
	static defines(instance) {
		return Number.isInteger(instance) && instance > -1;
	}
	static validate(string) {
		return this.expression.test(string);
	}
	static parse(string) {
		const int = parseInt(string);
		if (int === NaN)
			throw `!${this.name.toUpperCase()} PARSE ERROR! "${string}" is not an ${this.name}.`;
		return int;
	}
}

export class Int extends UInt {
	static expression = /^(\+|-)?[0-9]+$/;
	constructor(...args) {
		super(...args);
	}
}

// TODO: Make this a money specific thing instead?
export class Dbl extends Class(Number) {
	constructor(...args) {
		super(...args);
	}
	static stringify(dbl, size = 2) {
		return dbl.toFixed(size);
	}
}

// Options are A BIT like an enum... mull it over...
export const Options = Type(
	`Options`,
	{
		init(...values) {
			// WE SHOULD ASSUME ALL VALUES ARE OF THE SAME TYPE.
			// ACTUALLY, WE SHOULD ENFORCE IT.
			return Abstract(
				`Options<${values.join('|')}>`
			).static({
				defines(instance) {
					return values.some(value => value === instance);
				},
				stringify(instance) {
					return instance.constructor?.stringify(instance) || instance.toString();
				},
				parse(string) {
					// TODO: PARSING BASED ON ENFORCED TYPE ABOVE.
					return string.constructor?.stringify(instance) || instance;
				}
			});
		}
	}
);

export const Either = Type(
	`Either`,
	{
		init(...types) {
			return Abstract(
				`Either<${types.join('|')}>`
			).static({
				defines(instance) {
					return types.some(type => instance instanceof type)
				}
			});
		}
	}
)

// TODO: at the least it should be easy to "bubble" or "route" events...
export const Emitter = Abstract('Emitter', {
	_channels: Field(Any).assign(
		new Proxy({}, {
			get(obj, key) {
				return Reflect.has(obj, key) ?
						Reflect.get(obj, key) :
							Reflect.set(obj, key, []) && this.get(obj, key);
			}
		})),
	// TODO: rethink channels... they shoukld have this format: channel/path/to/sub/topic
	// THIS IS YET ANOTHER REASON WHY WE NEED A FILTER METHOD instead of separate channels
	// We SHOULD be able to listen to ALL events very readily such that we can relay them
	// to a higher level.... DO THIS.
	on(chnnl, listener) {
		const listeners = this._channels[chnnl];
		if (listeners.includes(listener))
			throw `DUPLICATE ERROR: ${
				listener.name
			} listener already bound to "${chnnl}" channel on ${
				this.constructor.name
			}.`;
		listeners.push(listener);
		return this;
	},
	emit(chnnl, ...msg) {
		return this._channels[chnnl].map(listener => listener(...msg));
	}
});

