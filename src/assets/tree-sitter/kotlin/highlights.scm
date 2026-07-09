; Query for @tree-sitter-grammars/tree-sitter-kotlin 1.1.0.

(line_comment) @comment
(block_comment) @comment

[
  (string_literal)
  (multiline_string_literal)
] @string

(escape_sequence) @string.escape
(character_literal) @character
(number_literal) @number

(package_header
  "package" @keyword
  (qualified_identifier) @module)

(import
  "import" @keyword.import)

(class_declaration
  name: (identifier) @type)

(object_declaration
  name: (identifier) @type)

(type_alias
  type: (identifier) @type.definition)

(user_type
  (identifier) @type)

(function_declaration
  name: (identifier) @function)

(call_expression
  (identifier) @function.call)

(call_expression
  (navigation_expression
    (identifier) @function.call))

(parameter
  (identifier) @variable.parameter)

(class_parameter
  (identifier) @variable.parameter)

(variable_declaration
  (identifier) @variable)

(identifier) @variable

[
  "class"
  "interface"
  "object"
] @keyword.type

[
  "fun"
] @keyword.function

[
  "val"
  "var"
  "by"
  "constructor"
  "init"
  "typealias"
] @keyword

[
  "if"
  "else"
  "when"
] @keyword.conditional

[
  "for"
  "while"
  "do"
] @keyword.repeat

[
  "return"
] @keyword.return

[
  "try"
  "catch"
  "finally"
  "throw"
] @keyword.exception

[
  "private"
  "protected"
  "public"
  "internal"
  "abstract"
  "actual"
  "annotation"
  "companion"
  "const"
  "crossinline"
  "data"
  "enum"
  "expect"
  "external"
  "final"
  "infix"
  "inline"
  "inner"
  "lateinit"
  "noinline"
  "open"
  "operator"
  "override"
  "sealed"
  "suspend"
  "tailrec"
  "vararg"
] @keyword.modifier

[
  "as"
  "as?"
  "is"
  "!is"
  "in"
  "!in"
  "="
  "+="
  "-="
  "*="
  "/="
  "%="
  "=="
  "!="
  "==="
  "!=="
  ">"
  ">="
  "<"
  "<="
  "&&"
  "||"
  "!"
  "+"
  "-"
  "*"
  "/"
  "%"
  "++"
  "--"
  "?."
  "?:"
  "!!"
  ".."
  "..<"
  "->"
] @operator

[
  "("
  ")"
  "["
  "]"
  "{"
  "}"
] @punctuation.bracket

[
  "."
  ","
  ";"
  ":"
  "::"
] @punctuation.delimiter
