import type { PluginFunction, Types } from '@graphql-codegen/plugin-helpers';
import type { GraphQLSchema, OperationDefinitionNode, VariableDefinitionNode } from 'graphql';
import type { ValidationSchemaPluginConfig } from './config.js';
import type { SchemaVisitor } from './types.js';
import { transformSchemaAST } from '@graphql-codegen/schema-ast';
import { buildSchema, Kind, printSchema, visit } from 'graphql';

import { isGeneratedByIntrospection, topologicalSortAST } from './graphql.js';
import { MyZodSchemaVisitor } from './myzod/index.js';
import { ValibotSchemaVisitor } from './valibot/index.js';
import { YupSchemaVisitor } from './yup/index.js';
import { ZodSchemaVisitor } from './zod/index.js';

export const plugin: PluginFunction<ValidationSchemaPluginConfig, Types.ComplexPluginOutput> = (
  schema: GraphQLSchema,
  documents: Types.DocumentFile[],
  config: ValidationSchemaPluginConfig,
): Types.ComplexPluginOutput => {
  const { schema: _schema, ast } = _transformSchemaAST(schema, config);
  const visitor = schemaVisitor(_schema, config);

  const result = visit(ast, visitor);

  const generated = result.definitions.filter(def => typeof def === 'string');

  // Generate operation variable schemas if enabled
  const operationVariableSchemas: string[] = [];
  const additionalImports: string[] = [];
  if (config.withOperationVariables && documents && documents.length > 0) {
    const { schemas, imports } = generateOperationVariableSchemas(documents, visitor, config);
    operationVariableSchemas.push(...schemas);
    additionalImports.push(...imports);
  }

  return {
    prepend: [...visitor.buildImports(), ...additionalImports],
    content: [visitor.initialEmit(), ...generated, ...operationVariableSchemas].join('\n'),
  };
};

function schemaVisitor(schema: GraphQLSchema, config: ValidationSchemaPluginConfig): SchemaVisitor {
  if (config?.schema === 'zod')
    return new ZodSchemaVisitor(schema, config);
  else if (config?.schema === 'myzod')
    return new MyZodSchemaVisitor(schema, config);
  else if (config?.schema === 'valibot')
    return new ValibotSchemaVisitor(schema, config);

  return new YupSchemaVisitor(schema, config);
}

function _transformSchemaAST(schema: GraphQLSchema, config: ValidationSchemaPluginConfig) {
  const { schema: _schema, ast } = transformSchemaAST(schema, config);

  // See: https://github.com/Code-Hex/graphql-codegen-typescript-validation-schema/issues/394
  const __schema = isGeneratedByIntrospection(_schema) ? buildSchema(printSchema(_schema)) : _schema;

  // This affects the performance of code generation, so it is
  // enabled only when this option is selected.
  if (config.validationSchemaExportType === 'const') {
    return {
      schema: __schema,
      ast: topologicalSortAST(__schema, ast),
    };
  }
  return {
    schema: __schema,
    ast,
  };
}

function generateOperationVariableSchemas(
  documents: Types.DocumentFile[],
  visitor: SchemaVisitor,
  config: ValidationSchemaPluginConfig,
): { schemas: string[]; imports: string[] } {
  const schemas: string[] = [];
  const imports = new Set<string>();
  const suffix = config.operationVariablesSchemaSuffix || 'VariableSchema';

  for (const documentFile of documents) {
    if (!documentFile.document) {
      continue;
    }

    for (const definition of documentFile.document.definitions) {
      if (definition.kind === Kind.OPERATION_DEFINITION) {
        const operation = definition as OperationDefinitionNode;

        if (!operation.variableDefinitions || operation.variableDefinitions.length === 0) {
          continue;
        }

        const operationName = operation.name?.value;
        if (!operationName) {
          continue;
        }

        const schemaName = operationName + suffix;
        const operationType = operation.operation.charAt(0).toUpperCase() + operation.operation.slice(1);
        const typeName = `${operationName}${operationType}Variables`;

        // Add the type to imports
        imports.add(typeName);

        // Generate the variable schema based on the validation library type
        if (config?.schema === 'zod') {
          schemas.push(generateZodOperationVariableSchema(operation.variableDefinitions, schemaName, typeName, visitor, config));
        }
        else if (config?.schema === 'myzod') {
          schemas.push(generateMyZodOperationVariableSchema(operation.variableDefinitions, schemaName, typeName, visitor, config));
        }
        else if (config?.schema === 'valibot') {
          schemas.push(generateValibotOperationVariableSchema(operation.variableDefinitions, schemaName, typeName, visitor, config));
        }
        else {
          // Default to yup
          schemas.push(generateYupOperationVariableSchema(operation.variableDefinitions, schemaName, typeName, visitor, config));
        }
      }
    }
  }

  // Generate import statement for operation variable types
  const importStatements: string[] = [];
  if (imports.size > 0 && config.importFrom) {
    const namedImportPrefix = config.useTypeImports ? 'type ' : '';

    if (config.schemaNamespacedImportName) {
      // If we're using namespaced imports, we don't need separate imports for operation variables
      // as they'll be accessed via the namespace
    }
    else {
      // Add separate import for operation variable types
      importStatements.push(`import ${namedImportPrefix}{ ${Array.from(imports).join(', ')} } from '${config.importFrom}'`);
    }
  }

  return { schemas, imports: importStatements };
}

function generateZodOperationVariableSchema(
  variables: readonly VariableDefinitionNode[],
  schemaName: string,
  typeName: string,
  visitor: SchemaVisitor,
  config: ValidationSchemaPluginConfig,
): string {
  const prefixedTypeName = config.schemaNamespacedImportName
    ? `${config.schemaNamespacedImportName}.${typeName}`
    : typeName;

  const fields = variables.map((variable) => {
    const fieldName = variable.variable.name.value;
    const fieldType = generateZodTypeFromGraphQLType(variable.type, visitor, config, variable.defaultValue);
    return `    ${fieldName}: ${fieldType}`;
  }).join(',\n');

  switch (config.validationSchemaExportType) {
    case 'const':
      return `export const ${schemaName}: z.ZodObject<Properties<${prefixedTypeName}>> = z.object({\n${fields}\n});`;
    case 'function':
    default:
      return `export function ${schemaName}(): z.ZodObject<Properties<${prefixedTypeName}>> {\n  return z.object({\n${fields}\n  });\n}`;
  }
}

function generateYupOperationVariableSchema(
  variables: readonly VariableDefinitionNode[],
  schemaName: string,
  typeName: string,
  visitor: SchemaVisitor,
  config: ValidationSchemaPluginConfig,
): string {
  const prefixedTypeName = config.schemaNamespacedImportName
    ? `${config.schemaNamespacedImportName}.${typeName}`
    : typeName;

  const fields = variables.map((variable) => {
    const fieldName = variable.variable.name.value;
    const fieldType = generateYupTypeFromGraphQLType(variable.type, visitor, config, variable.defaultValue);
    return `    ${fieldName}: ${fieldType}`;
  }).join(',\n');

  switch (config.validationSchemaExportType) {
    case 'const':
      return `export const ${schemaName}: yup.SchemaOf<${prefixedTypeName}> = yup.object({\n${fields}\n});`;
    case 'function':
    default:
      return `export function ${schemaName}(): yup.SchemaOf<${prefixedTypeName}> {\n  return yup.object({\n${fields}\n  });\n}`;
  }
}

function generateMyZodOperationVariableSchema(
  variables: readonly VariableDefinitionNode[],
  schemaName: string,
  typeName: string,
  visitor: SchemaVisitor,
  config: ValidationSchemaPluginConfig,
): string {
  const prefixedTypeName = config.schemaNamespacedImportName
    ? `${config.schemaNamespacedImportName}.${typeName}`
    : typeName;

  const fields = variables.map((variable) => {
    const fieldName = variable.variable.name.value;
    const fieldType = generateMyZodTypeFromGraphQLType(variable.type, visitor, config, variable.defaultValue);
    return `    ${fieldName}: ${fieldType}`;
  }).join(',\n');

  switch (config.validationSchemaExportType) {
    case 'const':
      return `export const ${schemaName}: mz.Type<${prefixedTypeName}> = mz.object({\n${fields}\n});`;
    case 'function':
    default:
      return `export function ${schemaName}(): mz.Type<${prefixedTypeName}> {\n  return mz.object({\n${fields}\n  });\n}`;
  }
}

function generateValibotOperationVariableSchema(
  variables: readonly VariableDefinitionNode[],
  schemaName: string,
  typeName: string,
  visitor: SchemaVisitor,
  config: ValidationSchemaPluginConfig,
): string {
  const prefixedTypeName = config.schemaNamespacedImportName
    ? `${config.schemaNamespacedImportName}.${typeName}`
    : typeName;

  const fields = variables.map((variable) => {
    const fieldName = variable.variable.name.value;
    const fieldType = generateValibotTypeFromGraphQLType(variable.type, visitor, config, variable.defaultValue);
    return `    ${fieldName}: ${fieldType}`;
  }).join(',\n');

  switch (config.validationSchemaExportType) {
    case 'const':
      return `export const ${schemaName}: v.ObjectSchema<${prefixedTypeName}, undefined> = v.object({\n${fields}\n});`;
    case 'function':
    default:
      return `export function ${schemaName}(): v.ObjectSchema<${prefixedTypeName}, undefined> {\n  return v.object({\n${fields}\n  });\n}`;
  }
}

// Helper functions to generate field types for each validation library
function generateZodTypeFromGraphQLType(type: any, visitor: SchemaVisitor, config: ValidationSchemaPluginConfig, defaultValue?: any): string {
  const isNonNull = type.kind === 'NonNullType';
  const actualType = isNonNull ? type.type : type;

  let zodType = '';

  if (actualType.kind === 'ListType') {
    const innerType = generateZodTypeFromGraphQLType(actualType.type, visitor, config);
    zodType = `z.array(${innerType})`;
  }
  else if (actualType.kind === 'NamedType') {
    const typeName = actualType.name.value;

    // Check if it's an input type that has a schema
    const graphqlType = (visitor as any).getSchema?.()?.getType(typeName);
    if (graphqlType?.astNode?.kind === 'InputObjectTypeDefinition') {
      zodType = config.validationSchemaExportType === 'const' ? `${typeName}Schema` : `${typeName}Schema()`;
    }
    else {
      // Handle scalars
      switch (typeName) {
        case 'String':
        case 'ID':
          zodType = 'z.string()';
          break;
        case 'Int':
        case 'Float':
          zodType = 'z.number()';
          break;
        case 'Boolean':
          zodType = 'z.boolean()';
          break;
        default:
          // Check if it's a custom scalar with schema
          if (config.scalarSchemas?.[typeName]) {
            zodType = config.scalarSchemas[typeName];
          }
          else if (graphqlType?.astNode?.kind === 'EnumTypeDefinition') {
            zodType = `${typeName}Schema`;
          }
          else {
            zodType = config.defaultScalarTypeSchema || 'z.any()';
          }
      }
    }
  }
  else {
    zodType = 'z.any()';
  }

  // Handle default values
  if (defaultValue) {
    if (defaultValue.kind === 'IntValue' || defaultValue.kind === 'FloatValue') {
      zodType = `${zodType}.default(${defaultValue.value})`;
    }
    else if (defaultValue.kind === 'StringValue') {
      zodType = `${zodType}.default("${defaultValue.value}")`;
    }
    else if (defaultValue.kind === 'BooleanValue') {
      zodType = `${zodType}.default(${defaultValue.value})`;
    }
    else if (defaultValue.kind === 'EnumValue') {
      zodType = `${zodType}.default(${actualType.name.value}.${defaultValue.value})`;
    }
  }

  // Add optional if not non-null
  if (!isNonNull) {
    zodType = `${zodType}.optional()`;
  }

  return zodType;
}

function generateYupTypeFromGraphQLType(type: any, visitor: SchemaVisitor, config: ValidationSchemaPluginConfig, defaultValue?: any): string {
  const isNonNull = type.kind === 'NonNullType';
  const actualType = isNonNull ? type.type : type;

  let yupType = '';

  if (actualType.kind === 'ListType') {
    const innerType = generateYupTypeFromGraphQLType(actualType.type, visitor, config);
    yupType = `yup.array(${innerType})`;
  }
  else if (actualType.kind === 'NamedType') {
    const typeName = actualType.name.value;

    const graphqlType = (visitor as any).getSchema?.()?.getType(typeName);
    if (graphqlType?.astNode?.kind === 'InputObjectTypeDefinition') {
      yupType = config.validationSchemaExportType === 'const' ? `${typeName}Schema` : `${typeName}Schema()`;
    }
    else {
      switch (typeName) {
        case 'String':
        case 'ID':
          yupType = 'yup.string()';
          break;
        case 'Int':
        case 'Float':
          yupType = 'yup.number()';
          break;
        case 'Boolean':
          yupType = 'yup.boolean()';
          break;
        default:
          if (config.scalarSchemas?.[typeName]) {
            yupType = config.scalarSchemas[typeName];
          }
          else if (graphqlType?.astNode?.kind === 'EnumTypeDefinition') {
            yupType = `${typeName}Schema`;
          }
          else {
            yupType = config.defaultScalarTypeSchema || 'yup.mixed()';
          }
      }
    }
  }
  else {
    yupType = 'yup.mixed()';
  }

  // Handle default values
  if (defaultValue) {
    if (defaultValue.kind === 'IntValue' || defaultValue.kind === 'FloatValue') {
      yupType = `${yupType}.default(${defaultValue.value})`;
    }
    else if (defaultValue.kind === 'StringValue') {
      yupType = `${yupType}.default("${defaultValue.value}")`;
    }
    else if (defaultValue.kind === 'BooleanValue') {
      yupType = `${yupType}.default(${defaultValue.value})`;
    }
    else if (defaultValue.kind === 'EnumValue') {
      yupType = `${yupType}.default(${actualType.name.value}.${defaultValue.value})`;
    }
  }

  // Add defined and optional for nullable fields
  if (isNonNull) {
    yupType = `${yupType}.defined()`;
  }
  else {
    yupType = `${yupType}.optional()`;
  }

  return yupType;
}

function generateMyZodTypeFromGraphQLType(type: any, visitor: SchemaVisitor, config: ValidationSchemaPluginConfig, defaultValue?: any): string {
  const isNonNull = type.kind === 'NonNullType';
  const actualType = isNonNull ? type.type : type;

  let myzodType = '';

  if (actualType.kind === 'ListType') {
    const innerType = generateMyZodTypeFromGraphQLType(actualType.type, visitor, config);
    myzodType = `mz.array(${innerType})`;
  }
  else if (actualType.kind === 'NamedType') {
    const typeName = actualType.name.value;

    const graphqlType = (visitor as any).getSchema?.()?.getType(typeName);
    if (graphqlType?.astNode?.kind === 'InputObjectTypeDefinition') {
      myzodType = config.validationSchemaExportType === 'const' ? `${typeName}Schema` : `${typeName}Schema()`;
    }
    else {
      switch (typeName) {
        case 'String':
        case 'ID':
          myzodType = 'mz.string()';
          break;
        case 'Int':
        case 'Float':
          myzodType = 'mz.number()';
          break;
        case 'Boolean':
          myzodType = 'mz.boolean()';
          break;
        default:
          if (config.scalarSchemas?.[typeName]) {
            myzodType = config.scalarSchemas[typeName];
          }
          else if (graphqlType?.astNode?.kind === 'EnumTypeDefinition') {
            myzodType = `${typeName}Schema`;
          }
          else {
            myzodType = config.defaultScalarTypeSchema || 'mz.unknown()';
          }
      }
    }
  }
  else {
    myzodType = 'mz.unknown()';
  }

  // Handle default values
  if (defaultValue) {
    if (defaultValue.kind === 'IntValue' || defaultValue.kind === 'FloatValue') {
      myzodType = `${myzodType}.default(${defaultValue.value})`;
    }
    else if (defaultValue.kind === 'StringValue') {
      myzodType = `${myzodType}.default("${defaultValue.value}")`;
    }
    else if (defaultValue.kind === 'BooleanValue') {
      myzodType = `${myzodType}.default(${defaultValue.value})`;
    }
    else if (defaultValue.kind === 'EnumValue') {
      myzodType = `${myzodType}.default(${actualType.name.value}.${defaultValue.value})`;
    }
  }

  // Add optional for nullable fields
  if (!isNonNull) {
    myzodType = `${myzodType}.optional()`;
  }

  return myzodType;
}

function generateValibotTypeFromGraphQLType(type: any, visitor: SchemaVisitor, config: ValidationSchemaPluginConfig, defaultValue?: any): string {
  const isNonNull = type.kind === 'NonNullType';
  const actualType = isNonNull ? type.type : type;

  let valibotType = '';

  if (actualType.kind === 'ListType') {
    const innerType = generateValibotTypeFromGraphQLType(actualType.type, visitor, config);
    valibotType = `v.array(${innerType})`;
  }
  else if (actualType.kind === 'NamedType') {
    const typeName = actualType.name.value;

    const graphqlType = (visitor as any).getSchema?.()?.getType(typeName);
    if (graphqlType?.astNode?.kind === 'InputObjectTypeDefinition') {
      valibotType = config.validationSchemaExportType === 'const' ? `${typeName}Schema` : `${typeName}Schema()`;
    }
    else {
      switch (typeName) {
        case 'String':
        case 'ID':
          valibotType = 'v.string()';
          break;
        case 'Int':
        case 'Float':
          valibotType = 'v.number()';
          break;
        case 'Boolean':
          valibotType = 'v.boolean()';
          break;
        default:
          if (config.scalarSchemas?.[typeName]) {
            valibotType = config.scalarSchemas[typeName];
          }
          else if (graphqlType?.astNode?.kind === 'EnumTypeDefinition') {
            valibotType = `${typeName}Schema`;
          }
          else {
            valibotType = config.defaultScalarTypeSchema || 'v.any()';
          }
      }
    }
  }
  else {
    valibotType = 'v.any()';
  }

  // Handle default values
  if (defaultValue) {
    if (defaultValue.kind === 'IntValue' || defaultValue.kind === 'FloatValue') {
      valibotType = `v.optional(${valibotType}, ${defaultValue.value})`;
    }
    else if (defaultValue.kind === 'StringValue') {
      valibotType = `v.optional(${valibotType}, "${defaultValue.value}")`;
    }
    else if (defaultValue.kind === 'BooleanValue') {
      valibotType = `v.optional(${valibotType}, ${defaultValue.value})`;
    }
    else if (defaultValue.kind === 'EnumValue') {
      valibotType = `v.optional(${valibotType}, ${actualType.name.value}.${defaultValue.value})`;
    }
  }
  else if (!isNonNull) {
    valibotType = `v.optional(${valibotType})`;
  }

  return valibotType;
}

export type { ValidationSchemaPluginConfig }
