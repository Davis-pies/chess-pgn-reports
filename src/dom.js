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

// Safely render a small markdown subset (bold/italic/code + newlines) into DOM
// nodes (no innerHTML, so note text can't inject markup).
export function renderInline(container, text) {
	const lines = text.split("\n");
	lines.forEach((line, li) => {
		if (li) container.appendChild(document.createElement("br"));
		const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
		let last = 0;
		let m;
		while ((m = re.exec(line))) {
			if (m.index > last)
				container.appendChild(
					document.createTextNode(line.slice(last, m.index)),
				);
			const tok = m[0];
			const bold = tok.startsWith("**");
			const code = tok.startsWith("`");
			const node = document.createElement(
				bold ? "strong" : code ? "code" : "em",
			);
			node.textContent = tok.slice(bold ? 2 : 1, tok.length - (bold ? 2 : 1));
			container.appendChild(node);
			last = m.index + tok.length;
		}
		if (last < line.length)
			container.appendChild(document.createTextNode(line.slice(last)));
	});
}
