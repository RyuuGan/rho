"use strict";

var defaults = require("./defaults")
  , InlineCompiler = require("./inline")
  , utils = require("./utils")
  , Walker = require("./walker").Walker
  , SubWalker = require("./walker").SubWalker
  , html = require("html");

/* # Block compiler

 Block compiler is what you usually use to transform a document.
 It walks a potentially large documents coarsely, looking for
 markers which designate the block. The inline markup (inside
 blocks) is processed by `InlineCompiler`.
 */
var BlockCompiler
  = module.exports
  = exports
  = function(options) {

  this.out = [];

  this.selector = {};

  this.blockIndent = 0;

  this.blockSrc = 0;

  this.options = utils.merge(defaults.options, options);

  this.inline = new InlineCompiler(this.options);

  this.inline.out = this.out;

};

/* ## Compilation

 Block compiler follows the conventions of `InlineCompiler`:

 * `tryXXX` methods are "fail-fast" and immediately return `false`,
 if they do not match the start of the block;
 * `emitXXX` methods do not return meaningful result; instead, they
 modify the output and increment the cursor position.

 */
BlockCompiler.prototype = {

  toHtml: function(input) {
    this.compile(input);
    return this.outToString();
  },

  reset: function() {
    this.out = [];
    this.selector = {};
    this.blockIndent = 0;
    this.blockSrc = 0;
    this.inline.out = this.out;
    return this;
  },

  compile: function(input) {
    this.reset();
    return this.processBlocks(new Walker(input));
  },

  processBlocks: function(walk) {
    while(walk.hasCurrent())
      this.emitBlock(walk);
    return this;
  },

  outToString: function() {
    var result = "";
    for (var i = 0; i < this.out.length; i++)
      result += this.out[i];
    if (this.options.pretty)
      result = html.prettyPrint(result, { indent_size: 2 }) + "\n";
    return result;
  },

  emitBlock: function(walk) {
    walk.skipBlankLines();
    this.blockSrc = walk.absoluteIndex(walk.position);
    this.countBlockIndent(walk);
    if (this.tryUnorderedList(walk)) return;
    if (this.tryOrderedList(walk)) return;
    if (this.tryHeading(walk)) return;
    if (this.tryCodeBlock(walk)) return;
    if (this.tryDiv(walk)) return;
    if (this.tryHtml(walk)) return;
    if (this.tryHrTable(walk)) return;
    this.emitParagraph(walk);
  },

  // Uses inline compiler to emit output of specified walk.

  emitInline: function(walk) {
    this.inline.processInlines(walk);
    return this;
  },

  /* Counts the spaces from line start up to the first non-whitespace char
   on the first line of a block. */

  countBlockIndent: function(walk) {
    this.blockIndent = 0;
    while (walk.hasCurrent() && walk.at(" ")) {
      this.blockIndent += 1;
      walk.skip();
    }
  },

  /* Selector expression is stripped from each block, if it exists,
   resulting in a new walker with excluded region. */
  stripSelector: function(walk) {
    this.selector = {};
    var start = walk.position;
    while (walk.hasCurrent() && !walk.atNewLine()) {
      if (walk.at("\\{")) {
        walk.skip(2);
        continue;
      }
      if (walk.at("{")) {
        var s = walk.position;
        walk.skip();
        this.trySelectorId(walk);
        while(this.trySelectorClass(walk)) {}
        if (!walk.at("}")) // invalid selector
          break;
        // Selector matched, exclude it
        walk.skip().skipSpaces();
        var e = walk.position;
        return walk.startFrom(start).exclude(s, e);
      } else walk.skip();
    }
    // Selector not found
    this.selector = {};
    walk.startFrom(start);
    return walk;
  },

  trySelectorId: function(walk) {
    if (!walk.at("#")) return false;
    walk.skip();
    var end = walk.lookahead(function(w) {
      while (w.hasCurrent() && w.atIdentifier())
        w.skip();
      return w.position;
    });
    this.selector.id = walk.yieldUntil(end);
    return true;
  },

  trySelectorClass: function(walk) {
    if (!walk.at(".")) return false;
    walk.skip();
    var end = walk.lookahead(function(w) {
      while (w.hasCurrent() && w.atIdentifier())
        w.skip();
      return w.position;
    });
    if (!Array.isArray(this.selector.classes))
      this.selector.classes = [];
    this.selector.classes.push(walk.yieldUntil(end));
    return true;
  },

  /* Selector is emitted as HTML `id` and `class` attributes. */

  emitSelector: function() {
    // emit id
    if (typeof this.selector.id == "string") {
      this.out.push(" id=\"" + this.selector.id + "\"");
    }
    // emit class
    if (Array.isArray(this.selector.classes)) {
      this.out.push(" class=\"");
      for (var i in this.selector.classes) {
        if (i > 0) this.out.push(" ");
        this.out.push(this.selector.classes[i]);
      }
      this.out.push("\"");
    }
    // emit data-src
    if (this.options.sourceIndices)
      this.out.push(" data-src=\"" + this.blockSrc + "\"");
  },

  /* Markered blocks are DIVs `~~~` and code blocks `\`\`\``. */

  tryCodeBlock: function(walk) {
    if (!walk.at("```")) return false;
    walk.skip(3);
    var startIdx = walk.position;
    var endIdx = walk.indexOf("```");
    if (endIdx === null) {
      // Not a code block
      walk.startFrom(startIdx - 3);
      return false;
    }
    var b = this.stripSelector(new SubWalker(walk, startIdx, endIdx));
    this.out.push("<pre");
    this.emitSelector();
    this.out.push("><code>");
    this.emitCode(b);
    this.out.push("</code></pre>");
    walk.startFrom(endIdx + 3).skipBlankLines();
    return true;
  },

  /* Code is processed line-by-line, block indent is stripped. */

  emitCode: function(walk) {
    walk.skipBlankLines();
    if (walk.atSpaces(this.blockIndent))
      walk.skip(this.blockIndent);
    while (walk.hasCurrent()) {
      if (walk.atNewLine()) {
        walk.skipNewLine();
        if (walk.atSpaces(this.blockIndent))
          walk.skip(this.blockIndent);
        if (walk.hasCurrent())
          this.out.push("\n");
      } else {
        this.inline.emitCode(walk);
      }
    }
  },

  /* Divs are simple blocks surrounded by `~~~`. They are extremely
   useful if you wish to attach a class to several blocks without
   changing their semantics. */

  tryDiv: function(walk) {
    if (!walk.at("~~~")) return false;
    walk.skip(3);
    var startIdx = walk.position;
    var endIdx = walk.indexOf("~~~");
    if (endIdx === null) {
      // Not a div
      walk.startFrom(startIdx - 3);
      return false;
    }
    var b = this.stripSelector(new SubWalker(walk, startIdx, endIdx));
    this.out.push("<div");
    this.emitSelector();
    this.out.push(">");
    while (b.hasCurrent())
      this.emitBlock(b);
    this.out.push("</div>\n");
    walk.startFrom(endIdx + 3).skipBlankLines();
    return true;
  },

  /* Unordered lists start with `* `, every line indented beyond
   the marker is included into `<li>`.*/

  tryUnorderedList: function(walk) {
    if (!walk.at("* ")) return false;
    var startIdx = walk.position;
    var found = false;
    // Find the end of the block, checking for nested subblocks
    while (!found && walk.hasCurrent()) {
      walk.scrollToTerm().skipBlankLines();
      if (walk.atSpaces(this.blockIndent)) {
        var i = walk.position;
        walk.skip(this.blockIndent);
        if (!walk.at("* ") && !walk.atSpace()) {
          found = true;
          walk.startFrom(i);
        }
      } else found = true;
    }
    // We got UL region, emit it
    var ul = this.stripSelector(new SubWalker(walk, startIdx, walk.position));
    this.emitUl(ul);
    return true;
  },

  emitUl: function(walk) {
    this.out.push("<ul");
    this.emitSelector();
    this.out.push(">");
    // Determining the bounds of each li
    walk.skip(2); // Skipping marker
    var startIdx = walk.position;
    while (walk.hasCurrent()) {
      walk.scrollToEol().skipBlankLines();
      if (walk.atSpaces(this.blockIndent) &&
        walk.skip(this.blockIndent).at("* ")) {
        var li = this.stripSelector(new SubWalker(walk, startIdx, walk.position));
        this.emitLi(li);
        // Skip next marker
        walk.skip(2);
        startIdx = walk.position;
      }
    }
    // Emit last li
    var last = this.stripSelector(new SubWalker(walk, startIdx, walk.position));
    this.emitLi(last);
    // All items emitted
    this.out.push("</ul>\n");
  },

  /* Ordered lists start with `1. ` and continue with any-digit marker. */

  tryOrderedList: function(walk) {
    if (!walk.at("1. ")) return false;
    var startIdx = walk.position;
    var found = false;
    // Find the end of the block, checking for nested subblocks
    while (!found && walk.hasCurrent()) {
      walk.scrollToTerm().skipBlankLines();
      if (walk.atSpaces(this.blockIndent)) {
        var i = walk.position;
        walk.skip(this.blockIndent);
        if (!this.lookingAtOlMarker(walk) && !walk.atSpace()) {
          found = true;
          walk.startFrom(i);
        }
      } else found = true;
    }
    // We got UL region, emit it
    var ol = this.stripSelector(new SubWalker(walk, startIdx, walk.position));
    this.emitOl(ol);
    return true;
  },

  lookingAtOlMarker: function(walk) {
    if (!walk.atDigit()) return false;
    return walk.lookahead(function(w) {
      while (w.atDigit())
        w.skip();
      return w.at(". ");
    });
  },

  emitOl: function(walk) {
    this.out.push("<ol");
    this.emitSelector();
    this.out.push(">");
    // Determining the bounds of each li
    walk.skipDigits().skip(2); // Skipping marker
    var startIdx = walk.position;
    while (walk.hasCurrent()) {
      walk.scrollToEol().skipBlankLines();
      if (walk.atSpaces(this.blockIndent) &&
        this.lookingAtOlMarker(walk.skip(this.blockIndent))) {
        var li = this.stripSelector(new SubWalker(walk, startIdx, walk.position));
        this.emitLi(li);
        // Skip next marker
        walk.skipDigits().skip(2);
        startIdx = walk.position;
      }
    }
    // Emit last li
    var last = this.stripSelector(new SubWalker(walk, startIdx, walk.position));
    this.emitLi(last);
    // All items emitted
    this.out.push("</ol>\n");
  },

  // LI emitting is universal -- both for OLs and ULs.

  emitLi: function(walk) {
    this.out.push("<li");
    this.emitSelector();
    this.out.push(">");
    // Determine, whether the contents is inline or block
    var b = walk.lookahead(function(w) {
      w.scrollToTerm().skipWhitespaces();
      return w.hasCurrent(); // In other words, there is a blank line inside
    });
    var indent = this.blockIndent;
    if (b) {
      while (walk.hasCurrent())
        this.emitBlock(walk);
      this.blockIndent = indent;
    } else this.emitInline(walk);
    this.out.push("</li>");
  },

  /* Headings start with `#`, the amount of pounds designate the level. */

  tryHeading: function(walk) {
    if (!walk.at("#")) return false;
    var startIdx = walk.position;
    var level = 0;
    while (walk.at("#")) {
      walk.skip();
      level += 1;
    }
    if (!walk.at(" ")) {
      walk.startFrom(startIdx);
      return false;
    }
    // This is heading now, emitting inplace
    var tag = "h" + level.toString();
    walk.skip();
    startIdx = walk.position;
    walk.scrollToTerm();
    var h = this.stripSelector(new SubWalker(walk, startIdx, walk.position));
    this.out.push("<");
    this.out.push(tag);
    this.emitSelector();
    this.out.push(">");
    this.emitInline(h);
    this.out.push("</");
    this.out.push(tag);
    this.out.push(">");
    return true;
  },

  /* Block HTML tags are emitted without much of modification. */

  tryHtml: function(walk) {
    if (!walk.at("<")) return false;
    var endIdx = walk.indexOf(">");
    if (endIdx === null) {
      return false;
    }
    var tag = walk.substring(walk.position, endIdx + 1);
    // Attempt to match a tag
    var m = htmlTagRe.exec(tag);
    if (m === null) {
      // Try HTML comment as well
      if (htmlCommentRe.test(tag)) {
        this.out.push(tag);
        walk.startFrom(endIdx).skipBlankLines();
        return true;
      }
      // Not HTML block or comment
      return false;
    }
    // Only block tags are accepted
    var tagName = m[1].toLowerCase();
    if (blockTags.indexOf(tagName) == -1) {
      // Seems like it's a paragraph starting with inline element
      return false;
    }
    // Search for corresponding closing tag
    var startIdx = walk.position;
    walk.startFrom(endIdx);
    this.scrollToClosingTag(walk, tagName);
    var w = new SubWalker(walk, startIdx, walk.position);
    while (w.hasCurrent())
      this.inline.emitPlain(w);
    return true;
  },

  scrollToClosingTag: function(walk, tagName) {
    var openingTag = "<" + tagName;
    var closingTag = "</" + tagName;
    var found = false;
    while (!found && walk.hasCurrent()) {
      // Closing tag
      if (walk.atInsensitive(closingTag)) {
        walk.skip(closingTag.length).scrollTo(">").skip();
        return;
      }
      // Opening tag: skipping it and search recursively
      if (walk.atInsensitive(openingTag)) {
        walk.skip(openingTag.length).scrollTo(">").skip();
        this.scrollToClosingTag(walk, tagName);
        continue;
      }
      // All other cases
      walk.skip();
    }
  },

  /* HRs and tables start with `---`. Their latter contents is ran through
   regex.*/

  tryHrTable: function(walk) {
    if (!walk.at("---")) return;
    var startIdx = walk.position;
    walk.scrollToTerm();
    var b = this.stripSelector(new SubWalker(walk, startIdx, walk.position));
    if (b.toString().trim() == "---")
      this.emitHr(b);
    else this.emitTable(b);
  },

  emitHr: function(walk) {
    this.out.push("<hr");
    this.emitSelector();
    this.out.push("/>");
  },

  emitTable: function(walk) {
    this.out.push("<table");
    this.emitSelector();
    this.out.push(">");
    // Scan for width marker at the end of initial `-`-sequence
    var widthAttr = "";
    while (walk.at("-")) walk.skip();
    if (walk.at(">")) {
      widthAttr = " width=\"100%\"";
      walk.skip();
    }
    // Columns count is determined by reading the first line
    var cells = this.readCells(walk);
    var cols = cells.length;
    var alignAttrs = [];
    var hasHead = false;
    // Scan the next line for alignment data, if it looks like separator line
    var startIdx = walk.position;
    walk.scrollToEol();
    var line = walk.substring(startIdx, walk.position);
    if (tableSeparatorLineRe.test(line)) {
      hasHead = true;
      var separators = this.readCells(new Walker(line));
      separators.forEach(function(e, i) {
        var m = e.trim();
        var left = m[0] == ":";
        var right = m[m.length - 1] == ":";
        if (left && right) alignAttrs[i] = " style=\"text-align:center\"";
        else if (left) alignAttrs[i] = " style=\"text-align:left\"";
        else if (right) alignAttrs[i] = " style=\"text-align:right\"";
      });
    }
    // Emitting head
    if (hasHead) {
      this.out.push("<thead>");
      this.emitRow("th", cells, alignAttrs);
      this.out.push("</thead>");
    }
    // Emitting body
    this.out.push("<tbody>");
    var found = false;
    if (!hasHead)  // Don't forget that first row!
      this.emitRow("td", cells, alignAttrs);
    while (!found && walk.hasCurrent()) {
      walk.skipWhitespaces();
      startIdx = walk.position;
      walk.scrollToEol();
      line = walk.substring(startIdx, walk.position).trim();
      if (tableEndRe.test(line))
        found = true;
      else {
        cells = this.readCells(new Walker(line));
        while (cells.length > cols)
          cells.pop();
        while (cells.length < cols)
          cells.push("");
        this.emitRow("td", cells, alignAttrs);
      }

    }
    this.out.push("</tbody>");
    this.out.push("</table>");
  },

  emitRow: function(tag, cells, alignAttrs) {
    this.out.push("<tr>");
    for (var i = 0; i < cells.length; i++) {
      var cell = cells[i];
      var a = alignAttrs[i];
      this.out.push("<");
      this.out.push(tag);
      if (a) this.out.push(a);
      this.out.push(">");
      if (cell.length)
        this.emitInline(new Walker(cell));
      this.out.push("</");
      this.out.push(tag);
      this.out.push(">");
    }
    this.out.push("</tr>");
  },

  // Columns are read line-by-line, cells are delimited with `|`

  readCells: function(walk) {
    var result = [];
    walk.skipWhitespaces();
    // Skipping leading pipe
    if (walk.at("|")) walk.skip();
    var i = walk.position;
    while (walk.hasCurrent() && !walk.atNewLine()) {
      // Respect backslash escape `\\|`
      if (walk.at("\\|")) walk.skip(2);
      if (walk.at("|")) {
        result.push(walk.substring(i, walk.position));
        walk.skip();
        i = walk.position;
      } else walk.skip();
    }
    // Don't forget the last cell
    var s = walk.substring(i, walk.position).trim();
    if (s != "")
      result.push(s);
    // Skip trailing whitespace
    walk.skipWhitespaces();
    return result;
  },

  /* Paragraph is the most generic block. It is emitted if
   other blocks did not match. */

  emitParagraph: function(walk) {
    walk.skipWhitespaces();
    if (walk.hasCurrent()) {
      var start = walk.position;
      walk.scrollToTerm();
      var p = this.stripSelector(new SubWalker(walk, start, walk.position));
      this.out.push("<p");
      this.emitSelector();
      this.out.push(">");
      this.emitInline(p);
      this.out.push("</p>\n");
    }
  }

};

/* ## Constants */

var blockTags = ["address", "article", "aside", "blockqoute", "canvas",
  "dd", "div", "dl", "dt", "fieldset", "figcaption", "figure", "footer",
  "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hgroup", "hr",
  "nospript", "ol", "output", "p", "pre", "section", "table", "ul"];

var htmlTagRe = /^<\/?([a-zA-Z]+)\b[\s\S]*?(\/)?>$/;
var htmlCommentRe = /^<!--[\s\S]*?-->$/;

var tableSeparatorLineRe = /^[- :|]+$/;
var tableEndRe = /^-{3,}$/;