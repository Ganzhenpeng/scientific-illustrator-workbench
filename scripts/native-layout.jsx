/* Original helpers for Illustrator ExtendScript (ES3).
   Coordinates are points measured right/down from the active artboard's top left.
   Execute in DOCUMENTCOORDINATESYSTEM; guarded-jsx.ps1 establishes and restores it.
   No file, shell, network, selection or document-management operations occur here. */
var ScientificLayout = (function () {
    function finite(value, name) {
        if (typeof value !== "number" || !isFinite(value)) throw new Error(name + " must be finite");
        return value;
    }
    function positive(value, name) {
        finite(value, name);
        if (value <= 0) throw new Error(name + " must be positive");
        return value;
    }
    function documentOf(item) {
        var current = item, attempts = 0;
        while (current && current.typename !== "Document" && attempts++ < 64) current = current.parent;
        if (!current || current.typename !== "Document") throw new Error("Object has no document parent");
        return current;
    }
    function boardOf(doc, index) {
        var active = typeof index === "number" ? index : doc.artboards.getActiveArtboardIndex();
        if (active < 0 || active >= doc.artboards.length) throw new Error("Invalid artboard index");
        return doc.artboards[active].artboardRect;
    }
    function point(doc, x, y) {
        var board = boardOf(doc);
        return [board[0] + finite(x, "x"), board[1] - finite(y, "y")];
    }
    function rgb(hex) {
        if (typeof hex !== "string" || !/^#[0-9a-fA-F]{6}$/.test(hex)) throw new Error("Use a #RRGGBB color");
        var color = new RGBColor();
        color.red = parseInt(hex.substr(1, 2), 16);
        color.green = parseInt(hex.substr(3, 2), 16);
        color.blue = parseInt(hex.substr(5, 2), 16);
        return color;
    }
    function color(value) { return typeof value === "string" ? rgb(value) : value; }
    function paint(item, options) {
        var opts = options || {}, width = opts.strokeWidth === undefined ? 1 : finite(opts.strokeWidth, "strokeWidth");
        if (width < 0) throw new Error("strokeWidth must not be negative");
        item.filled = opts.fill !== undefined && opts.fill !== null;
        if (item.filled) item.fillColor = color(opts.fill);
        item.stroked = opts.stroke !== undefined && opts.stroke !== null && width > 0;
        if (item.stroked) { item.strokeColor = color(opts.stroke); item.strokeWidth = width; }
        if (opts.name) item.name = opts.name;
        return item;
    }
    function rect(layer, x, y, width, height, options) {
        var doc = documentOf(layer), at = point(doc, x, y), opts = options || {}, item;
        positive(width, "width"); positive(height, "height");
        if (opts.radius !== undefined) {
            var radius = finite(opts.radius, "radius");
            if (radius < 0 || radius > Math.min(width, height) / 2) throw new Error("Invalid corner radius");
            item = layer.pathItems.roundedRectangle(at[1], at[0], width, height, radius, radius);
        } else item = layer.pathItems.rectangle(at[1], at[0], width, height);
        return paint(item, opts);
    }
    function text(layer, contents, x, y, options) {
        var opts = options || {}, doc = documentOf(layer), at = point(doc, x, y);
        var size = opts.size === undefined ? 18 : positive(opts.size, "size");
        var font = opts.font || "ArialMT";
        // Resolve the font before creating a frame, so a missing font does not leave a partial text object.
        var resolvedFont = app.textFonts.getByName(font);
        var frame = layer.textFrames.add();
        frame.contents = String(contents).replace(/\r\n|\n/g, "\r");
        frame.textRange.characterAttributes.textFont = resolvedFont;
        frame.textRange.characterAttributes.size = size;
        frame.textRange.characterAttributes.fillColor = color(opts.fill || "#17384C");
        if (opts.leading !== undefined) {
            frame.textRange.characterAttributes.autoLeading = false;
            frame.textRange.characterAttributes.leading = positive(opts.leading, "leading");
        }
        if (opts.name) frame.name = opts.name;
        frame.left = at[0]; frame.top = at[1];
        return frame;
    }
    function polyline(layer, points, options) {
        if (!points || points.length < 2) throw new Error("A path needs at least two points");
        var doc = documentOf(layer), converted = [], opts = options || {}, i;
        for (i = 0; i < points.length; i++) {
            if (!points[i] || points[i].length !== 2) throw new Error("Use [x, y] points");
            converted.push(point(doc, points[i][0], points[i][1]));
        }
        var path = layer.pathItems.add();
        path.setEntirePath(converted); path.closed = !!opts.closed;
        return paint(path, opts);
    }
    function arrow(layer, start, end, options) {
        var opts = options || {}, dx = finite(end[0], "end x") - finite(start[0], "start x");
        var dy = finite(end[1], "end y") - finite(start[1], "start y");
        var length = Math.sqrt(dx * dx + dy * dy), size = opts.headSize === undefined ? 8 : positive(opts.headSize, "headSize");
        if (length <= size) throw new Error("Arrow must be longer than its head");
        var group = layer.groupItems.add(), ink = opts.stroke || "#20849A", ux = dx / length, uy = dy / length;
        if (opts.name) group.name = opts.name;
        polyline(group, [start, [end[0] - ux * size, end[1] - uy * size]], {stroke: ink, strokeWidth: opts.strokeWidth === undefined ? 1.5 : opts.strokeWidth});
        polyline(group, [end, [end[0] - ux * size - uy * size * 0.45, end[1] - uy * size + ux * size * 0.45],
            [end[0] - ux * size + uy * size * 0.45, end[1] - uy * size - ux * size * 0.45]], {closed: true, fill: ink});
        return group;
    }
    function bounds(item, doc, artboardIndex) {
        var board = boardOf(doc || documentOf(item), artboardIndex), raw = item.visibleBounds;
        var b = {left: raw[0] - board[0], top: board[1] - raw[1], right: raw[2] - board[0], bottom: board[1] - raw[3]};
        if (b.left > b.right || b.top > b.bottom) throw new Error("Unexpected visible bounds");
        b.width = b.right - b.left; b.height = b.bottom - b.top;
        return b;
    }
    function inside(inner, outer, tolerance) {
        return inner.left >= outer.left - tolerance && inner.top >= outer.top - tolerance &&
            inner.right <= outer.right + tolerance && inner.bottom <= outer.bottom + tolerance;
    }
    function overlap(a, b, tolerance) {
        return Math.min(a.right, b.right) - Math.max(a.left, b.left) > tolerance &&
            Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > tolerance;
    }
    function Audit(doc, options) {
        this.document = doc; this.options = options || {}; this.records = [];
    }
    Audit.prototype.add = function (name, item, role, parentName, options) {
        if (!name || typeof name !== "string") throw new Error("Give every registered item a unique name");
        if (documentOf(item) !== this.document) throw new Error("Cannot register an item from another document");
        for (var i = 0; i < this.records.length; i++) if (this.records[i].name === name) throw new Error("Duplicate audit name: " + name);
        var opts = options || {};
        if (opts.allowBleed !== undefined && finite(opts.allowBleed, "allowBleed") < 0) throw new Error("allowBleed must not be negative");
        if (opts.parentPadding !== undefined && finite(opts.parentPadding, "parentPadding") < 0) throw new Error("parentPadding must not be negative");
        this.records.push({name: name, item: item, role: role || (item.typename === "TextFrame" ? "text" : "shape"), parentName: parentName || null, options: opts});
        return item;
    };
    Audit.prototype.check = function () {
        var doc = this.document, opts = this.options, records = this.records, errors = [], objects = [], i, j;
        var tolerance = opts.tolerance === undefined ? 0.5 : finite(opts.tolerance, "tolerance");
        if (tolerance < 0) throw new Error("tolerance must not be negative");
        var board = boardOf(doc, opts.artboardIndex), canvas = {left: 0, top: 0, right: board[2] - board[0], bottom: board[1] - board[3]};
        function error(code, name, message) { errors.push({code: code, name: name, message: message}); }
        function find(name) { for (var k = 0; k < objects.length; k++) if (objects[k].name === name) return objects[k]; return null; }
        function isCovered(item) {
            var current = item, depth = 0;
            while (current && current.typename !== "Document" && depth++ < 64) {
                for (var k = 0; k < records.length; k++) if (records[k].item === current) return true;
                current = current.parent;
            }
            return false;
        }
        for (i = 0; i < records.length; i++) {
            var record = records[i], b = bounds(record.item, doc, opts.artboardIndex);
            objects.push({name: record.name, role: record.role, parentName: record.parentName, bounds: b});
            var allowance = record.options.allowBleed || 0;
            if (!inside(b, canvas, tolerance + allowance)) error("artboard-overflow", record.name, "Visible bounds leave the artboard beyond the declared bleed");
        }
        for (i = 0; i < records.length; i++) {
            var row = records[i], child = objects[i], padding = row.options.parentPadding || 0;
            if (row.parentName) {
                var parent = find(row.parentName);
                if (!parent) error("missing-parent", row.name, "Parent was not registered: " + row.parentName);
                else {
                    var inset = {left: parent.bounds.left + padding, top: parent.bounds.top + padding,
                        right: parent.bounds.right - padding, bottom: parent.bounds.bottom - padding};
                    if (!inside(child.bounds, inset, tolerance)) error("parent-overflow", row.name, "Visible bounds leave parent: " + row.parentName);
                }
            }
            if (row.role === "text") {
                for (j = 0; j < records.length; j++) {
                    if (records[j].role === "arrow" && overlap(child.bounds, objects[j].bounds, tolerance))
                        error("text-arrow-overlap", row.name, "Bounding boxes intersect arrow: " + records[j].name);
                }
            }
        }
        var unregistered = [], items = doc.pageItems;
        for (i = 0; i < items.length; i++) if (!isCovered(items[i])) unregistered.push(items[i].name || items[i].typename || "unnamed");
        if (unregistered.length && opts.requireCoverage !== false) error("incomplete-coverage", "document", unregistered.length + " page items were not registered or covered by a registered group");
        return {passed: errors.length === 0, errors: errors, objects: objects,
            scope: "Registered visible bounding boxes; overlap tests are conservative and not path intersection tests",
            coverage: {documentItems: items.length, registeredObjects: records.length, unregisteredItems: unregistered}};
    };
    return {rgb: rgb, rect: rect, text: text, polyline: polyline, arrow: arrow, bounds: bounds, Audit: Audit};
}());
