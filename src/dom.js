// Minimal DOM-construction helper shared across app.js and the extracted
// view modules.
export function el(tag, props, children = []) {
	const e = document.createElement(tag);
	Object.assign(e, props);
	(Array.isArray(children) ? children : [children]).forEach((c) =>
		typeof c === "string"
			? e.appendChild(document.createTextNode(c))
			: e.appendChild(c),
	);
	return e;
}
