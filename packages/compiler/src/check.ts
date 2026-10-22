import path from 'node:path';
import ts from 'typescript';

export interface Diagnostic {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly severity: 'error' | 'warning';
  /** AVI001 too few, AVI002 not checkable, AVI003 unknown token, AVI004 wrong type. */
  readonly code: string;
  readonly message: string;
}

/**
 * Type-checks every `static inject` list in a TypeScript project against its class constructor.
 * Decorated classes get this from the compiler already; this covers undecorated ones too.
 */
export function checkInjectLists(project: string): Diagnostic[] {
  const config = ts.getParsedCommandLineOfConfigFile(path.resolve(project), undefined, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
      throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
    },
  });
  if (!config) throw new Error(`Cannot read ${project}`);

  const program = ts.createProgram({ rootNames: config.fileNames, options: config.options });
  const checker = program.getTypeChecker();
  const roots = new Set(config.fileNames.map((file) => path.resolve(file)));
  const diagnostics: Diagnostic[] = [];

  for (const source of program.getSourceFiles()) {
    if (source.isDeclarationFile || !roots.has(path.resolve(source.fileName))) continue;
    const visit = (node: ts.Node): void => {
      if (ts.isClassLike(node)) checkClass(node, source, checker, diagnostics);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  return diagnostics.sort((a, b) =>
    a.file === b.file ? a.line - b.line || a.column - b.column : a.file.localeCompare(b.file),
  );
}

function checkClass(
  node: ts.ClassLikeDeclaration,
  source: ts.SourceFile,
  checker: ts.TypeChecker,
  out: Diagnostic[],
): void {
  const inject = node.members.find(
    (member): member is ts.PropertyDeclaration =>
      ts.isPropertyDeclaration(member) &&
      (ts.getCombinedModifierFlags(member) & ts.ModifierFlags.Static) !== 0 &&
      member.name.getText(source) === 'inject',
  );
  if (!inject) return;

  const className = node.name?.text ?? '(anonymous class)';
  const report = (at: ts.Node, severity: Diagnostic['severity'], code: string, message: string) => {
    const { line, character } = source.getLineAndCharacterOfPosition(at.getStart(source));
    out.push({
      file: source.fileName,
      line: line + 1,
      column: character + 1,
      severity,
      code,
      message,
    });
  };

  const list = unwrap(inject.initializer);
  if (!list || !ts.isArrayLiteralExpression(list)) {
    report(
      inject,
      'warning',
      'AVI002',
      `${className}.inject is not an array literal and cannot be checked`,
    );
    return;
  }
  if (list.elements.some(ts.isSpreadElement)) {
    report(list, 'warning', 'AVI002', `${className}.inject uses a spread and cannot be checked`);
    return;
  }

  const ctor = node.members.find(ts.isConstructorDeclaration);
  const params = ctor?.parameters ?? ts.factory.createNodeArray<ts.ParameterDeclaration>();
  const required = params.filter(
    (p) => !p.questionToken && !p.initializer && !p.dotDotDotToken,
  ).length;
  if (list.elements.length < required) {
    report(
      list,
      'error',
      'AVI001',
      `${className} needs ${String(required)} constructor arguments but inject lists ${String(list.elements.length)}`,
    );
  }

  params.forEach((param, i) => {
    const element = list.elements[i];
    if (!element || param.dotDotDotToken) return;
    const provided = tokenType(element, checker);
    if (!provided) {
      report(
        element,
        'warning',
        'AVI003',
        `Cannot tell what ${element.getText(source)} resolves to`,
      );
      return;
    }
    const expected = checker.getTypeAtLocation(param);
    if (!checker.isTypeAssignableTo(provided, expected)) {
      report(
        element,
        'error',
        'AVI004',
        `${className}.inject[${String(i)}] provides ${checker.typeToString(provided)}, but parameter "${param.name.getText(source)}" expects ${checker.typeToString(expected)}`,
      );
    }
  });
}

function unwrap(expression: ts.Expression | undefined): ts.Expression | undefined {
  let current = expression;
  while (
    current &&
    (ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isParenthesizedExpression(current) ||
      ts.isTypeAssertionExpression(current))
  ) {
    current = current.expression;
  }
  return current;
}

/** A class token resolves to its instance type; an `InjectionToken<T>` to `T`. */
function tokenType(element: ts.Expression, checker: ts.TypeChecker): ts.Type | undefined {
  const type = checker.getTypeAtLocation(element);
  const construct = type.getConstructSignatures()[0];
  if (construct) return construct.getReturnType();
  if (type.getSymbol()?.getName() === 'InjectionToken') {
    return checker.getTypeArguments(type as ts.TypeReference)[0];
  }
  return undefined;
}
