/* A synthetic native-vector example. Run only through guarded-jsx.ps1.
   No scientific result is represented by these shapes. */
var L = ScientificLayout;
var doc = SCI_DOCUMENT;
var layer = doc.layers[0]; layer.name = "Native editable example";
var audit = new L.Audit(doc);
function add(name, item, role, parent) { return audit.add(name, item, role, parent, {parentPadding: 10}); }
add("background", L.rect(layer, 0, 0, 1080, 600, {fill: "#FFFFFF", name: "background"}));
add("title", L.text(layer, "Scientific illustration in native vectors", 65, 55, {size: 30, fill: "#19374A", name: "title"}), "text");
add("subtitle", L.text(layer, "An original editable demonstration", 65, 103, {size: 15, fill: "#516B7B", name: "subtitle"}), "text");
var titles = ["Specimen", "Measurement", "Analysis"];
var details = ["Two material layers", "Observe the response", "Compare the fields"];
for (var i = 0; i < 3; i++) {
    var x = 65 + i * 335, card = "card_" + i;
    add(card, L.rect(layer, x, 180, 280, 300, {fill: "#F3F8FB", stroke: "#BDD3DF", radius: 8, name: card}));
    add("label_" + i, L.text(layer, titles[i], x + 25, 381, {size: 23, fill: "#19374A", name: "label_" + i}), "text", card);
    add("detail_" + i, L.text(layer, details[i], x + 25, 424, {size: 16, fill: "#516B7B", name: "detail_" + i}), "text", card);
    if (i === 0) {
        for (var c = 0; c < 4; c++) {
            add("upper_" + c, L.rect(layer, x + 28 + c * 56, 249, 56, 25, {fill: c % 2 ? "#167F8A" : "#276AA4", stroke: "#FFFFFF", name: "upper_" + c}), "shape", card);
            add("lower_" + c, L.rect(layer, x + 28 + c * 56, 274, 56, 25, {fill: c % 2 ? "#276AA4" : "#167F8A", stroke: "#FFFFFF", name: "lower_" + c}), "shape", card);
        }
    } else {
        for (var row = 0; row < (i === 2 ? 2 : 1); row++) {
            var pts = [];
            for (var j = 0; j <= 32; j++) pts.push([x + 28 + j * 7, 263 + row * 38 + Math.sin(j / 32 * Math.PI * 2) * 18]);
            add("wave_" + i + "_" + row, L.polyline(layer, pts, {stroke: row ? "#167F8A" : "#276AA4", strokeWidth: 2.4, name: "wave_" + i + "_" + row}), "shape", card);
        }
    }
    if (i < 2) add("arrow_" + i, L.arrow(layer, [x + 290, 330], [x + 325, 330], {stroke: "#276AA4", name: "arrow_" + i}), "arrow");
}
var result = audit.check();
if (!result.passed) throw new Error("Native example failed audit: " + result.errors[0].message);
var aiTarget = new File(SCI_OUTPUT_ROOT + "/native-demo.ai");
if (aiTarget.exists) throw new Error("Refusing to overwrite native-demo.ai");
var aiOptions = new IllustratorSaveOptions(); aiOptions.pdfCompatible = true;
doc.saveAs(aiTarget, aiOptions);
var pngOptions = new ExportOptionsPNG24(); pngOptions.transparency = false;
pngOptions.artBoardClipping = true; pngOptions.horizontalScale = 150; pngOptions.verticalScale = 150;
doc.exportFile(new File(SCI_OUTPUT_ROOT + "/native-demo.png"), ExportType.PNG24, pngOptions);
var report = new File(SCI_OUTPUT_ROOT + "/native-qa.txt"); report.encoding = "UTF-8";
if (!report.open("w")) throw new Error("Cannot save audit result");
report.write("Audit passed; registered objects=" + result.objects.length + "; unregistered=" + result.coverage.unregisteredItems.length + "; text frames=" + doc.textFrames.length + "; paths=" + doc.pathItems.length + "; raster=" + doc.rasterItems.length + "; placed=" + doc.placedItems.length);
report.close();
SCI_RESULT = "Native example saved; audit passed; all document objects covered.";
