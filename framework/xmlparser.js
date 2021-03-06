/**
 * @author Ani Sinanaj
 * @module xmlparser
 * @dependencies: xmlparser/extract, xmlparser/proxies
 */

/**
 * Dependencies
 */
var Extract = require('T/support/xmlparser/extract').extract;
var DefaultProxies = require('T/support/xmlparser/proxies');

/**
 * Global variables
 */
var viewCount = 0; // just a counter to have the number of created views
var customProxies = {};
var customReplacers = {};
var container = null;

/**
 * Parse the given string of `xml`.
 *
 * @param {String} xml
 * @return {Object}
 * @api public
 */
function parse(xml, opts) {
	opts = opts || {};
	var fontTransform = _.extend({
		italic: {
			fontStyle: 'italic'
		},
		bold: {
			fontWeight: 'bold'
		}
	}, opts.fontTransform);

	DefaultProxies.opts = opts;
	DefaultProxies.fontTransform = fontTransform;

	var proxies = _.extend({}, DefaultProxies.proxies, customProxies, opts.proxies);
	var replacers = _.extend({}, DefaultProxies.replacers, customReplacers, opts.replacers);

	container = opts.container || container || Ti.UI.createScrollView({layout: "vertical", height: Ti.UI.SIZE, width: Ti.UI.SIZE});
	var currentLabel; // variable to use for constucting multi style labels
	var androidHtml = "";
	var tempAttributes = [];

	exports.container = container;

	// strip comments and whitespaces
	xml = xml.trim();
	xml = xml.replace(/<!--[\s\S]*?-->/g, '').replace(new RegExp("\n" ,"g"), '');

	// apply replacers
	_.each(replacers, function(replacer, type) {
		if (replacer.openTag == null) {
			Ti.API.warn('XMLParser: a replacer has been defined for', type, 'but with no openTag attribute. Defaulting to empty string.');
			replacer.openTag = '';
		}
		if (replacer.closeTag == null) {
			Ti.API.warn('XMLParser: a replacer has been defined for', type, 'but with no closeTag attribute. Defaulting to empty string.');
			replacer.closeTag = '';
		}

		xml = xml
		.replace(new RegExp("<" + type + "[^>]*>" ,"g"), replacer.openTag)
		.replace(new RegExp("<\/" + type + ">" ,"g"), replacer.closeTag);
	});

	xml = removeUndefinedTags(xml, proxies);

	// start processing
	tag(xml);

	//finalize currentLabel if it's not null
	finalizeLabel();

	if (_.isFunction(opts.callback)) {
		opts.callback();
	}

	return container;

	/**
	 * Tag.
	 */
	function tag(data) {
		if (data == null) {
			return;
		}

		var re = /^<([\w-:.]+)\s*/;
		var m = re.exec(data);
		var el;

		// starts with simple text, could have children later
		if (!m) {
			// check if there are children
			var c = /<([\w-:.]+)\s*/.exec(data);
			var text = data;

			if(c != null && c[0] != null) {
				// split, process, loop
				text = text.substr(0,c.index);
				data = data.substr(c.index);

			} else {
				data = "";
			}

			el = proxy({
				name: "span",
				attributes: {},
				start: 0,
				end: data.length,
				text: text,
				content: data
			}); // create proxy

			// loop
			if(data == null || 0 != data.length) tag(data);
			return;
		}

		// case when content starts with a child
		var block 	= Extract(data,m[1]);
		var child 	= re.exec(block.content);
		var content = block.content;

		// if the block has at least a child, iterate in it.
		data = data.replace(data.slice(block.start, block.end - block.start), '');
		if (!!child) {
			el = proxy(block); // create proxy
			tag(block.content);
		}

		// if the block doesn't start with a child but has text
		if (!child && !!content.length) {
			if (block.text.length != block.content.length) {
				// Maybe don't override the content. Check if it doesn't break anything
				el = proxy(_.extend(_.clone(block), {text: "", content: ""}));
				tag(block.content);

			} else {
				el = proxy(block); // create proxy
			}
		}

		// i.e. <br/>
		if (!child && !content.length) el = proxy(block);

		if (el && el.end && _.isFunction(el.end)) {
			finalizeLabel();
			container.addTo = null;
			el.end(container);
		}

		// continue with the rest of the xml
		tag(data);
		return;
	}

	/**
	 * Strip.
	 */

	function strip(val) {
		return val.replace(/^['"]|['"]$/g, '');
	}

	/**
	 * .
	 */

	function proxy(element) {
		viewCount++;

		if (null == proxies[element.name]) element.name = "span";

		if (proxies[element.name].type == exports.TYPE_TEXT && _.isFunction(proxies[element.name].handler)) {
			if (null == currentLabel) currentLabel = {text: "", attributes: []};

			// fix t.attributes ranges
			var t = proxies[element.name].handler(element, container);
			currentLabel.text += t.text;
			cascadingAttributes(t, element);

		} else if (proxies[element.name].type == exports.TYPE_CUSTOM && _.isFunction(proxies[element.name].handler)) {
			// check if currentLabel is null
			finalizeLabel();
			proxies[element.name].handler(element, container);
		}

		return proxies[element.name];
	}

	function cascadingAttributes(e, element) {
		if (e.text.replace(/^\s+|\s+$/g, '') == "") {
			tempAttributes = concatAttributes(tempAttributes, e.attributes);
		} else {
			var start = currentLabel.text.length - e.text.length, length = e.text.length;
			tempAttributes = concatAttributes(tempAttributes, e.attributes);

			_.each(tempAttributes, function(a) {
				if (a.range == null) {
					a.range = [start, length];
				}

				currentLabel.attributes.push(a);
			});

			if(element.content.length == element.text.length) tempAttributes = [];
		}
	}

	function concatAttributes(haystack, needles) {
		var attrs = [];
		_.each(haystack, function(attr) {
			_.each(needles, function(needle, index) {
				if (attr.type == needle.type) {
					switch(attr.type) {
						case Ti.UI.ATTRIBUTE_FONT:
							attr.value = _.extend(attr.value, needle.value);
							needles.splice(index,1);
							break;
					}
				}
			});
		});
		return haystack.concat(needles);
	}

	function finalizeLabel() {
		if (null == currentLabel) return;

		if (opts.lineSpacing && OS_IOS) {
			currentLabel.attributes.push({
				type: Ti.UI.ATTRIBUTE_PARAGRAPH_STYLE,
				value: {
					lineSpacing: opts.lineSpacing
				},
				range: [0,currentLabel.text.length]
			});
		}

		if (opts.characterSpacing && OS_IOS) {
			currentLabel.attributes.push({
				type: Ti.UI.ATTRIBUTE_KERN,
				value: opts.characterSpacing,
				range: [0,currentLabel.text.length]
			});
		}

		var labelProperties = null;
		var as = null;

		if (OS_IOS) {
			as = Ti.UI.createAttributedString(currentLabel);
			labelProperties = _.extend({
				attributedString: as,
				font: {fontSize: 14}
			}, opts.textStyle);
		} else {
			// Android crashes if an attribute of AttributedString has no type.
			currentLabel.attributes = _.filter(currentLabel.attributes, function(attr) {
				return attr.type != null;
			});

			as = Ti.UI.createAttributedString(currentLabel);
			labelProperties = _.extend({
				lineSpacing: {add: opts.lineSpacing, multiply: 1.2},
				attributedString: as,
				font: {fontSize: 14}
			}, opts.textStyle);
		}

		var label = Ti.UI.createLabel(labelProperties);
		label.addEventListener("link", linkHandler);
		// add label to container

		if (container.addTo) container.addTo.add(label);
		else container.add(label);

		tempAttributes = [];
		currentLabel = null;
		androidHtml = "";
		label = null;
	}

	function linkHandler(e) {
		if (null != opts.linkHandler && _.isFunction(opts.linkHandler)) {
			opts.linkHandler(e);
			return;
		}

		if (e.url) Ti.Platform.openURL(e.url);
	}
}

function removeUndefinedTags(text, proxies) {
	text = text || "";
	var tags = Object.keys(proxies).join('|');
	var reOpen = new RegExp('<(?!(' + tags + '|\/))[^>]*>', 'g'); // This RegExp will select all the open tags not defined by the proxies parameter
	var reClose = new RegExp('<\/(?!(' + tags + '))[^>]*>', 'g'); // This RegExp will select all the close tags not defined by the proxies parameter

	text = text.replace(reOpen, '').replace(reClose, '');

	return text;
}

/**
 * Expose `parse`.
 */
exports.process = parse;

/**
 * Public methods
 */

// Use this method to set your own proxies
exports.overrideProxies = function(p) {
	_.extend(customProxies, p);
};

// Use this method to set your own replacers
exports.overrideReplacers = function(r) {
	_.extend(customReplacers, r);
};

// Use this method to set your own container view
exports.setContainer = function(view) {
	container = view;
};

// A getter for the container
exports.getContainer = function() {
	return container;
};

/**
 * Setting type constants
 */
exports.TYPE_TEXT = 0;
exports.TYPE_CUSTOM = 1;
