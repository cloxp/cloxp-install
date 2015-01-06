module('lively.ide.codeeditor.BetterConfig').requires('lively.Traits', 'lively.ide.commands.default').toRun(function() {


function ensureCodeEditorPreferences() {
    // Config.addOption("textDebugging", true,
    //          "used in text impl to enable / disable debugging and warnings",
    //          'lively.morphic.text');

    lively.Config.set('maxStatusMessages', 10);
    require('lively.ide.CodeEditor').toRun(function() {
        [{name: "defaultCodeFontSize", value: 12, set: "style.fontSize"},
         {name: "aceDefaultTheme", value: "chrome", set: "style.them"},
         //  {name: "aceWorkspaceTheme", value: "tomorrow_night"},
         //  {name: "aceTextEditorTheme", value: "tomorrow_night", set: "style.theme"},
         {name: "aceSystemCodeBrowserTheme", value: "chrome"},
         {name: "aceDefaultLineWrapping", value: false, set: "style.lineWrapping"},
         {name: "defaultSCBSourcePaneToListPaneRatio", value: 0.65},
         {name: "defaultSCBExtent", value: [840,650]}
        ].forEach(function(setting) {
            lively.Config.set(setting.name, setting.value);
            setting.set && lively.PropertyPath(setting.set).set(lively.morphic.CodeEditor.prototype, setting.value);
        });

        var setup = lively.Config.lookup("codeEditorUserKeySetup");
        if (users.robertkrahn.codeEditorKeysEnabled && setup) {
            lively.whenLoaded(function(world) {
                var eds = world.withAllSubmorphsSelect(function(ea) { return ea.isCodeEditor; })
                        .forEach(function(ea) { if (!ea.hasRobertsKeys) setup(ea); });
            });
        }
    });
}


(function textSetup() {

var tabSize = 2;
lively.Config.set('defaultTabSize', tabSize);
module("lively.ide.CodeEditor").runWhenLoaded(function() {
  lively.morphic.CodeEditor.prototype.style.tabSize = tabSize; });

// make paren behavior the default in all modes:
lively.module('lively.ide.codeeditor.ace').runWhenLoaded(function() {
    lively.ide.ace.require('ace/mode/text').Mode.addMethods({
        // FIXME just overwriting $behaviour property in mode prototype isn't
        // enough because the mode constructor unfortunately sets the behavior
        // directly. So we also delete the ownProperty behavior in attach
        $behaviour: new (lively.ide.ace.require("ace/mode/behaviour/cstyle").CstyleBehaviour)(),
        attach: function(ed) {
            // replace "Null-Behavior" only
            if (this.$behaviour && this.$behaviour.constructor === lively.ide.ace.require("ace/mode/behaviour").Behaviour)
                delete this.$behaviour;
        }
    });
});

function codeEditor() {
    var focused = lively.morphic.Morph.focusedMorph();
    return focused && focused.isCodeEditor && focused;
}

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

function setupEmacsKeyboardHandler(editor, handler) {
    if (editor.getKeyboardHandler() !== handler)
        editor.keyBinding.addKeyboardHandler(handler);
    editor.session.$useEmacsStyleLineStart = false;
    delete editor.getKeyboardHandler().commandKeyBinding['m-x'];
    handler.platform = UserAgent.isLinux || UserAgent.isWindows ? 'win' : 'mac';

    // debugging:
    handler.handleKeyboard = handler.handleKeyboard.getOriginal();
    // handler.handleKeyboard = handler.handleKeyboard.getOriginal().wrap(function(proceed, data, hashId, key, keyCode) {
    //     // show(data.keyChain);
    //     // disconnect(data, 'keyChain', Global, 'show', {
    //     //     updater: function($upd, val) { keyChains.push(val); $upd(val) },
    //     //     varMapping: {keyChains: keyChains}
    //     // });
    // // var keyChainEnter = data.keyChain.length > 0 && data.keyChain;
    // // if (keyChainEnter) debugger
    // show("data %s, hashId %s, key %s, keyCode %s", data, hashId, key, keyCode);
    // if (data.keyChain) debugger;
    // // if (data.keyChain && hashId === 1 && keyCode === -1) debugger;
    // // if (hashId === 1 && keyCode === 67) debugger;
    // var result = proceed(data, hashId, key, keyCode);
    // // var keyChainExit = data.keyChain.length > 0 && data.keyChain;
    // // (keyChainExit || keyChainEnter) && show("keyChain enter: %s, exit: %s, command: %o",
    //     // keyChainEnter, keyChainExit, result);
    //     // show("%s -> %o", data.keyChain, result)
    //     return result;
    // });
}

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

Global.setupIyGoToChar = function(keyboardHandler) {
    var debug = false;
    function iyGoToChar(editor, options) {
        var kbd = editor.getKeyboardHandler();
        if (kbd.isIyGoToChar) return;

        var HashHandler = lively.ide.ace.require("ace/keyboard/hash_handler").HashHandler,
            iyGoToCharHandler = new HashHandler();

        iyGoToCharHandler.isIyGoToChar = true;

        iyGoToCharHandler.handleKeyboard = function(data, hashId, key, keyCode) {
            // first invocation: if a key is pressed remember this char as the char
            // to search for
            // subsequent invocations: when the same char is pressed, move to the
            // next found location of that char, other wise deactivate this mode

            // shift key or raw event
            debug && show("hashId: %s, key: %s", hashId, key);
            // shift = hashId 4
            if ((hashId === 0 && key !== 'esc' && key !== 'backspace') || hashId === 4) return {command: 'null', passEvent: true};
            if (!this.charToFind) {
                if (key && hashId === -1) {
                    this.charToFind = key;
                } else {
                    editor.keyBinding.removeKeyboardHandler(this);
                    return null;
                }
            }
            if (key !== this.charToFind) {
                debug && show('input was %s and not %s, exiting', key, this.charToFind);
                editor.keyBinding.removeKeyboardHandler(this);
                return null;
            }
            return {
                command: iyGoToCharHandler.commands.moveForwardTo,
                args: {backwards: options.backwards, needle: key, preventScroll: true, wrap: false}};
        }

        iyGoToCharHandler.attach = function(editor) {
            debug && show('iygotochar installed');
            this.$startPos = editor.getCursorPosition();
        }
        iyGoToCharHandler.detach = function(editor) {
            debug && show('iygotochar uninstalled');
            if (this.$startPos && editor.pushEmacsMark) editor.pushEmacsMark(this.$startPos, false);
        }

        iyGoToCharHandler.addCommands([{
            name: 'moveForwardTo',
            exec: function(ed, options) {
                var sel = ed.selection, range = sel.getRange();
                if (options.backwards) sel.moveCursorLeft();
                options.start = sel.getSelectionLead();
                var foundRange = ed.find(options);
                if (!foundRange) {
                    if (options.backwards) sel.moveCursorRight();
                    return;
                }
                var hasSel = ed.emacsMark ? !!ed.emacsMark() : !sel.selection.isEmpty();
                var start, end;
                if (!hasSel) { start = foundRange.end, end = foundRange.end }
                else {
                    start = options.backwards ? foundRange.start : range.start;
                    end = options.backwards ? range.end : foundRange.end
                }
                var newRange = foundRange.constructor.fromPoints(start, end);
                sel.setRange(newRange, options.backwards);
            },
            multiSelectAction: 'forEach',
            readOnly: true
        }]);
        editor.keyBinding.addKeyboardHandler(iyGoToCharHandler);
    }

    function iyGoToCharBackwards(editor, args) {
        iyGoToChar(editor, {backwards: true});
    }

    keyboardHandler.addCommands([{name: 'iyGoToChar', exec: iyGoToChar, readOnly: true}]);
    keyboardHandler.addCommands([{name: 'iyGoToCharBackwards', exec: iyGoToCharBackwards, readOnly: true}]);
    keyboardHandler.bindKeys({"CMD-.": "iyGoToChar"});
    keyboardHandler.bindKeys({"CMD-,": "iyGoToCharBackwards"});
}

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

Config.addOption("codeEditorUserKeySetup", function(_codeEditor) {
    var e = _codeEditor.aceEditor, kbd = e.getKeyboardHandler();
    if (!users.robertkrahn.codeEditorKeysEnabled) {
        if (kbd.isEmacs) {
            // we have our own version of exec
            e.keyBinding.setKeyboardHandler(e.commands);
            e.commands.hasLivelyKeys = false;
            lively.ide.CodeEditor.KeyboardShortcuts.defaultInstance().attach(_codeEditor);
        }
        return;
    }
    // if (codeEditor.hasRobertsKeys) return;
    lively.morphic.CodeEditor.prototype.loadAceModule(["keybinding", 'ace/keyboard/emacs'], function(emacsKeys) {
        _codeEditor.hasRobertsKeys = true;
        setupEmacsKeyboardHandler(e, emacsKeys.handler);
        var kbd = emacsKeys.handler;

        // ------------------
        // key command setup
        // ------------------
        kbd.addCommands([{
            name: 'markword',
            exec: function(ed) {
                var sel = ed.selection;
                var range = sel.getRange();
                ed.moveCursorToPosition(range.end);
                sel.moveCursorWordRight();
                range.setEnd(sel.lead.row, sel.lead.column);
                // sel.selectToPosition(range.start);
                sel.setRange(range, true);
                // sel.setRange(ace.require('ace/range').Range.fromPoints(range.start, sel.lead), true);
            },
            multiSelectAction: 'forEach',
            readOnly: false
        }, {
            name: 'jumpToMark',
            exec: function(ed) {
                var sel = ed.selection;
                var p = sel.isEmpty() ? ed.getLastEmacsMark() : sel.anchor;
                p && ed.moveCursorToPosition(p);
            },
            readOnly: true
        }, {
            name: 'pushMark',
            exec: function(ed) {
                ed.pushEmacsMark(ed.getCursorPosition());
            },
            readOnly: true
        }, {
           name: "dividercomment",
           exec: function(editor) {
               editor.insert("-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-");
               editor.toggleCommentLines();
            }
        }, {
            name: "toogleSCBSizing",
            exec: function(ed) {
                // hack: get currently active system browser and do "run test command"
                var win = $world.getActiveWindow(),
                    focus = $world.focusedMorph(),
                    browser = win && win.targetMorph && win.targetMorph.ownerWidget;
                // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
                // FIXME
                if (focus.owner && focus.owner.name === "ObjectInspector") {
                    var div = focus.owner.submorphs.grep('divider').first();
                    if (!div) return;
                    var ratio = div.getRelativeDivide(),
                        newRatio = ratio <= 0.35 ? 0.7 : 0.35;
                    div.divideRelativeToParent(newRatio);
                    return;
                }
                // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
                if (!browser || !browser.isSystemBrowser) {
                    alert('Currently not in a SCB!'); return; }
                var div = win.targetMorph.midResizer,
                    ratio = div.getRelativeDivide(),
                    newRatio = ratio <= 0.2 ? 0.45 : 0.2;
                div.divideRelativeToParent(newRatio);
            }
        }, {
            name: 'fixTextScale',
            exec: function(ed, args) {
                var m = codeEditor();
                m.setScale(1/m.world().getScale());
                var ext = m.origExtent || (m.origExtent = m.getExtent());
                m.setExtent(ext.scaleBy(m.world().getScale()));
            },
            handlesCount: true
        },
        // todo
        {
            name: "toggleTodoMarker",
            exec: function(ed) {
                var range = ed.session.selection.getRange();
                if (range.isEmpty()) {
                    ed.$morph.selectCurrentLine();
                    range = ed.session.selection.getRange();
                }
                var text = ed.session.getTextRange(range),
                    undoneRe = /\[\s*\]/g,
                    doneRe = /\[X\]/g,
                    replacement = text;
                if (undoneRe.test(text)) {
                    replacement = text.replace(undoneRe, '[X]');
                } else if (doneRe.test(text)) {
                    replacement = text.replace(doneRe, '[ ]');
                } else { return; }
                ed.session.replace(range, replacement);
            }
        }, {
            name: "addOrRemoveTodoMarker",
            exec: function(ed) {
                ed.$morph.selectCurrentLine();
                var range = ed.session.selection.getRange(),
                    text = ed.session.getTextRange(range),
                    todoInFrontRe = /^(\s*)\[.?\]\s*(.*)/,
                    replacement = text;
                if (todoInFrontRe.test(text)) {
                    replacement = text.replace(todoInFrontRe, '$1$2');
                } else {
                    replacement = text.replace(todoInFrontRe = /^(\s*)(.*)/, '$1[ ] $2');
                }
                ed.session.replace(range, replacement);
            }
        },
        // commandline
        {
            name: 'returnorcommandlineinput',
            exec: function(ed) {
                if (!codeEditor().isCommandLine) { ed.insert("\n"); return; }
                codeEditor().commandLineInput && codeEditor().commandLineInput(ed.getValue());
            }
        }]);

        var shiftCmdPrefix = kbd.platform === 'mac' ? 'S-CMD-' : 'S-C-',
            cmdLPrefix = shiftCmdPrefix + 'l ';
        function bind(keys, command) { var binding = {}; binding[keys] = command; return binding; };

        kbd.bindKeys({"C-Up": 'gotoPrevParagraph'});
        kbd.bindKeys({"C-Down": 'gotoNextParagraph'});

        kbd.bindKeys({"M-g": 'null'});
        kbd.bindKeys({"M-g g": 'gotoline'});
        kbd.bindKeys({"M-g n": 'gotoNextErrorOrWarning'});
        kbd.bindKeys({"M-g p": 'gotoPrevErrorOrWarning'});

        kbd.bindKeys({"CMD-2": "pushMark"});
        kbd.bindKeys({"CMD-3": "jumpToMark"});
        kbd.bindKeys({"S-M-2": "markword"});

        kbd.bindKeys({"C-x C-u": "touppercase"});
        kbd.bindKeys({"C-x C-l": "tolowercase"});

        // lines
        kbd.bindKeys({"C-M-P": "addCursorAbove"});
        kbd.bindKeys({"C-M-N": "addCursorBelow"});
        kbd.bindKeys({"C-CMD-Up": "movelinesup"});
        kbd.bindKeys({"C-CMD-P": "movelinesup"});
        kbd.bindKeys({"C-CMD-Down": "movelinesdown"});
        kbd.bindKeys({"C-CMD-N": "movelinesdown"});
        kbd.bindKeys({"C-c j": "joinLineAbove"});
        kbd.bindKeys({"C-c S-j": "joinLineBelow"});
        kbd.bindKeys({'C-c p': "duplicateLine"});
        kbd.bindKeys({'C-c CMD-j': "curlyBlockOneLine"});
        kbd.bindKeys(bind(cmdLPrefix + "c a r", "alignSelection"));

        kbd.bindKeys(bind(cmdLPrefix + "j s s t r", "stringifySelection"));
        kbd.bindKeys(bind(cmdLPrefix + "d i f f", "openDiffer"));
        kbd.bindKeys(bind(cmdLPrefix + "m o d e", "changeTextMode"));

        // SCb
        kbd.bindKeys({'C-c C-t': "runtests"});
        kbd.bindKeys({'S-F6': "toogleSCBSizing"});

        kbd.bindKeys(bind(cmdLPrefix + "l t", "toggleLineWrapping"));

        kbd.bindKeys(bind(cmdLPrefix + "/ d", "dividercomment"));
        kbd.bindKeys(bind(cmdLPrefix + "/ b", "commentBox"));

        // evaluation
        kbd.bindKeys({"C-x C-e": "printit"});
        kbd.bindKeys(bind(cmdLPrefix + "x b", {command: "evalAll", args: {confirm: true}}));
        kbd.bindKeys({"CMD-i": "printInspect"}); // re-apply to be able to use count arg
        kbd.bindKeys({"CMD-g": "doAutoEvalPrintItComments"});

        kbd.bindKeys({"C-h k": "describeKey"});

        kbd.bindKeys({"C-x h": "selectall"});
        kbd.bindKeys({"C-c C-S-,": "selectAllLikeThis"});
        kbd.bindKeys({"CMD-f": 'moveForwardToMatching'});
        kbd.bindKeys({"CMD-b": 'moveBackwardToMatching'});
        kbd.bindKeys({"S-CMD-f": 'selectToMatchingForward'});
        kbd.bindKeys({"S-CMD-b": 'selectToMatchingBackward'});

        kbd.bindKeys(bind(cmdLPrefix + "f i x", 'fixTextScale'));

        kbd.bindKeys(bind(cmdLPrefix + "d a t e", 'insertDate'));

        // kbd.bindKeys({"Return": 'returnorcommandlineinput'});

        kbd.bindKeys(bind(cmdLPrefix + "b r o w s e", 'browseURLOrPathInWebBrowser'));
        kbd.bindKeys(bind(cmdLPrefix + "d a t e", 'insertDate'));
        kbd.bindKeys(bind(cmdLPrefix + "s-o", 'doBrowseAtPointOrRegion'));

        kbd.bindKeys(bind(cmdLPrefix + "s n i p", 'browseSnippets'));
        kbd.bindKeys(bind("S-CMD-c", 'browseSnippets'));

        kbd.bindKeys({"M-q": 'fitTextToColumn'});
        kbd.bindKeys(bind(cmdLPrefix + "w t", 'cleanupWhitespace'));
        kbd.bindKeys(bind(cmdLPrefix + "x m l p", 'prettyPrintHTMLAndXML'));

        kbd.bindKeys(bind(cmdLPrefix + "t d", 'toggleTodoMarker'));
        kbd.bindKeys(bind(cmdLPrefix + "t n", 'addOrRemoveTodoMarker'));
        Global.setupIyGoToChar(kbd);
    });
});

})();

(function interactiveCommands() {;

Object.extend(lively.ide.commands.defaultBindings, { // bind commands to default keys
    'lively.ide.openIframe': "cmd-s-l i f r a m e",
    'lively.ide.codeSearch': "cmd-s-l Shift-g",
    'lively.ide.CommandLineInterface.doGrepSearch': "cmd-s-l g"
});

})();

(function configCustomizations() {
    ensureCodeEditorPreferences();
    lively.Config.set('improvedJavaScriptEval', true);
    // lively.Config.set('showImprovedJavaScriptEvalErrors', true);
})();

}) // end of module
