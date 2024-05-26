import Constants from "./constants";

export default class Grammar {

  static makeGrammar() {

    // get the grammar source, written in Ohm
    const source = Grammar.getGrammarSource();

    let modules;
    let patches;
    let tweaks;
    let controls;

    // make the grammar
    let grammar = ohm.grammar(source);
    let semantics = grammar.createSemantics();

    // list of control parameters

    semantics.addOperation("interpret", {
      Graph(a, b) {
        modules = new Map();
        patches = new Map();
        tweaks = [];
        // always have access to pitch and level
        controls = ["pitch", "level"];
        return `{"synth":{${a.interpret()}},"statements":[${"".concat(b.children.map(z => z.interpret()))}]}`;
      },
      Synthblock(a, b, c, d, e, f, g, h) {
        return `${b.interpret()},${c.interpret()},${d.interpret()},${e.interpret()},${f.interpret()},${g.interpret()}`;
      },
      Parameter(a, b, c, d, e, f, g, h, i, j) {
        return `{"param":{${b.interpret()},${c.interpret()},${d.interpret()},${e.interpret()},${f.interpret()},${g.interpret()},${h.interpret()},${i.interpret()}}}`;
      },
      Paramtype(a, b, c) {
        return `"type":"${c.interpret()}"`;
      },
      Mutable(a, b, c) {
        return `"mutable":"${c.sourceString}"`;
      },
      validtype(a) {
        return a.sourceString;
      },
      Paramstep(a, b, c) {
        return `"step":${c.interpret()}`;
      },
      Minval(a, b, c) {
        return `"min":${c.interpret()}`;
      },
      Maxval(a, b, c) {
        return `"max":${c.interpret()}`;
      },
      Defaultval(a, b, c) {
        return `"default":${c.interpret()}`;
      },
      paramname(a, b) {
        let controlname = a.sourceString + b.sourceString;
        controls.push(controlname);
        return `"name":"${controlname}"`;
      },
      shortname(a, b) {
        return `"shortname":"${a.sourceString}${b.sourceString}"`;
      },
      Longname(a, b, c) {
        return `"longname":${c.interpret()}`;
      },
      Type(a, b, c) {
        return `"type":"${c.interpret()}"`;
      },
      Patchtype(a) {
        return a.sourceString;
      },
      Author(a, b, c) {
        return `"author":${c.interpret()}`;
      },
      Version(a, b, c) {
        return `"version":${c.interpret()}`;
      },
      Docstring(a, b, c) {
        return `"doc":${c.interpret()}`;
      },
      string(a, b) {
        return `"${a.sourceString}${b.sourceString}"`;
      },
      versionstring(a) {
        return `"${a.sourceString}"`;
      },
      inputparam(a) {
        return a.sourceString;
      },
      outputparam(a) {
        return a.sourceString;
      },
      Patch(a, b, c) {
        const from = a.interpret();
        const to = c.interpret();
        if (patches.get(from) === to)
          throwError(`duplicate patch connection`, this.source);
        const fromObj = JSON.parse(from);
        const toObj = JSON.parse(to);
        if (fromObj.id === toObj.id)
          throwError(`cannot patch a module into itself`, this.source);
        patches.set(from, to);
        return `{"patch":{"from":${from},"to":${to}}}`;
      },
      patchoutput(a, b, c) {
        const id = a.interpret();
        const param = c.interpret();
        if (id != "audio") { // audio out
          if (!modules.has(id))
            throwError(`a module called "${id}" has not been defined"`, this.source);
          const type = modules.get(id);
          if (!Constants.VALID_PATCH_OUTPUTS[type].includes(param))
            throwError(`cannot patch the parameter "${param}" of module "${id}"`, this.source);
        }
        return `{"id":"${id}","param":"${param}"}`;
      },
      patchinput(a, b, c) {
        const id = a.interpret();
        const param = c.interpret();
        if (id != "audio") { // audio in
          if (!modules.has(id))
            throwError(`a module called "${id}" has not been defined`, this.source);
          const type = modules.get(id);
          if (!Constants.VALID_PATCH_INPUTS[type].includes(param))
            throwError(`cannot patch the parameter "${param}" of module "${id}"`, this.source);
        }
        return `{"id":"${id}","param":"${param}"}`;
      },
      Tweak(a, b, c) {
        let tweakedParam = a.interpret();
        let obj = JSON.parse(`{${tweakedParam}}`);
        let twk = `${obj.id}.${obj.param}`;
        // check that this is a valid tweak
        let type = modules.get(obj.id);
        if (!Constants.VALID_TWEAKS[type].includes(obj.param))
          throwError(`cannot set the parameter "${obj.param}" of module "${obj.id}"`, this.source);
        if (tweaks.includes(twk))
          throwError(`you cannot set the value of ${twk} more than once`, this.source);
        tweaks.push(twk);
        return `{"tweak":{${tweakedParam},${c.interpret()}}}`;
      },
      comment(a, b) {
        return `{"comment":"${b.sourceString.trim()}"}`;
      },
      tweakable(a, b, c) {
        let id = a.interpret();
        if (!modules.has(id))
          throwError(`the module "${id}" has not been defined`, this.source);
        return `"id":"${id}", "param":"${c.sourceString}"`;
      },
      varname(a, b) {
        return a.sourceString + b.sourceString;
      },
      Declaration(a, b, c) {
        const type = a.interpret();
        const id = c.interpret();
        if (modules.has(id))
          throwError(`module "${id}" has already been defined`, this.source);
        modules.set(id, type);
        return `{"module":{"type":"${type}","id":"${id}"}}`;
      },
      module(a) {
        return a.sourceString;
      },
      Exp(a) {
        return `"expression":"${a.interpret()}"`;
      },
      AddExp(a) {
        return a.interpret();
      },
      AddExp_add(a, b, c) {
        return `${a.interpret()}+${c.interpret()}`;
      },
      AddExp_subtract(a, b, c) {
        return `${a.interpret()}-${c.interpret()}`;
      },
      MulExp(a) {
        return a.interpret();
      },
      MulExp_times(a, b, c) {
        return `${a.interpret()}*${c.interpret()}`
      },
      MulExp_divide(a, b, c) {
        return `${a.interpret()}/${c.interpret()}`
      },
      ExpExp_paren(a, b, c) {
        return `(${b.interpret()})`;
      },
      ExpExp_neg(a, b) {
        return `-${b.interpret()}`;
      },
      ExpExp(a) {
        return a.interpret();
      },
      Function_map(a, b, c, d, e, f, g, h) {
        return `map(${c.interpret()},${e.interpret()},${g.interpret()})`;
      },
      Function_random(a, b, c, d, e, f) {
        return `random(${c.interpret()},${e.interpret()})`
      },
      Function_exp(a, b, c, d) {
        return `exp(${c.interpret()})`
      },
      Function_log(a, b, c, d) {
        return `log(${c.interpret()})`
      },
      number(a) {
        return a.interpret();
      },
      integer(a, b) {
        const sign = (a.sourceString == "-") ? -1 : 1;
        return sign * parseInt(b.sourceString);
      },
      floatingpoint(a, b, c, d) {
        const sign = (a.sourceString == "-") ? -1 : 1;
        return sign * parseFloat(b.sourceString + "." + d.sourceString);
      },
      control(a, b, c, d) {
        let ctrl = c.sourceString + d.sourceString;
        if (!controls.includes(ctrl))
          throwError(`control parameter "${ctrl}" has not been defined`, this.source);
        return `param.${ctrl}`;
      }
    });

    return { synthSemantics: semantics, synthGrammar: grammar };

  }

  static getGrammarSource() {
    return String.raw`
        Synth {
      
        Graph = Synthblock Statement+
      
        Parameter = "@param" paramname Paramtype Mutable Paramstep Minval Maxval Defaultval Docstring "@end"
      
        Synthblock = "@synth" shortname Longname Type Author Version Docstring "@end"
      
        shortname = letter (letter | "-")+
      
        paramname = letter (alnum | "_")+
      
        Mutable (a yes or no value)
        = "mutable" ":" yesno
      
        yesno = "yes" | "no"
      
        Paramtype (a parameter type)
        = "type" ":" validtype
      
        Paramstep (a parameter step value)
        = "step" ":" number
      
        validtype (a valid type)
        = "float" | "int"
      
        Longname (a long name)
        = "longname" ":" string
      
        Type (a patch type)
        = "type" ":" Patchtype
      
        Patchtype (a synth or effect type)
        = "synth" | "effect"
      
        Minval (a minimum value)
        = "min" ":" number
      
        Maxval (a maximum value)
        = "max" ":" number
      
        Defaultval (a default value)
        = "default" ":" number
      
        Author (an author)
        = "author" ":" string
      
        Version (a version string)
        = "version" ":" versionstring
      
        Docstring (a documentation string)
        = "doc" ":" string
      
        versionstring (a version string)
        = (alnum | "." | "-" | " ")+
      
        string (a string)
        = letter (alnum | "." | "," | "-" | " " | "(" | ")" )*
      
        quote (a quote)
        = "\""
      
        Statement = comment
        | Parameter
        | Patch
        | Tweak
        | Declaration
      
        Patch = patchoutput "->" (patchinput | audio)
      
        patchoutput = varname "." outputparam
      
        patchinput = varname "." inputparam
      
        inputparam = "in" | "levelCV" | "pitchCV" | "cutoffCV" | "pulsewidthCV" | "angleCV" | "lagCV" | "thresholdCV" | "symmetryCV" | "gainCV"
      
        outputparam = "out"
      
        audio = "audio.in"
      
        comment (a comment)
        = "#" commentchar*
      
        commentchar = alnum | "." | "+" | "-" | "/" | "*" | "." | ":" | blank
      
        Tweak = tweakable "=" Exp
      
        Declaration = module ":" varname
      
        module = "SAW-OSC"
        | "SIN-OSC"
        | "SQR-OSC"
        | "TRI-OSC"
        | "PULSE-OSC"
        | "LFO"
        | "NOISE"
        | "LPF"
        | "HPF"
        | "VCA"
        | "SHAPER"
        | "ADSR"
        | "DECAY"
        | "PAN"
        | "DELAY"
        | "FOLDER"
      
        Exp
          = AddExp
      
        AddExp
          = AddExp "+" MulExp  -- add
        | AddExp "-" MulExp  -- subtract
        | MulExp
      
        MulExp
          = MulExp "*" ExpExp -- times
          | MulExp "/" ExpExp -- divide
          | ExpExp
      
        ExpExp
          = "(" AddExp ")" -- paren
          | "-" ExpExp -- neg
          | Function
          | number
          | control
      
        Function
          = "map" "(" AddExp "," number "," number ")" -- map
          | "random" "(" number "," number ")" -- random
          | "exp" "(" AddExp ")" -- exp
          | "log" "(" AddExp ")" -- log
      
        control (a control parameter)
        = "param" "." letter (alnum | "_")+
      
        tweakable
        = varname "." parameter
      
        parameter = "pitch" | "detune" | "level" | "lag" | "phase" | "angle" | "cutoff" | "resonance" | "attack" | "decay" | "sustain" | "release" | "fuzz" | "pulsewidth" | "threshold" | "symmetry" | "gain" | "stages"
      
        varname (a module name)
        = lower alnum*
      
        number (a number)
        = floatingpoint | integer
      
        floatingpoint = "-"? digit+ "." digit+
      
        integer = "-"? digit+
      
        blank = " "
      
      }
      `;
  }

}