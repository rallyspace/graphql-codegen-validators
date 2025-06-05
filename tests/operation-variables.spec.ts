import { describe, it, expect } from 'vitest';
import { buildSchema, parse } from 'graphql';
import { plugin } from '../src/index.js';
import type { ValidationSchemaPluginConfig } from '../src/config.js';

const schema = buildSchema(/* GraphQL */ `
  scalar Date
  scalar URL

  enum PageType {
    LP
    SERVICE
    RESTRICTED
    BASIC_AUTH
  }

  enum HTTPMethod {
    GET
    POST
  }

  type Query {
    story(id: ID!): Story
    user(id: ID!): User
    posts(filters: [String!], limit: Int, offset: Int): [Post!]!
  }

  type Mutation {
    updateDefaultBrandKit(input: PageInput!): Story
    createUser(email: String!, name: String!, age: Int): User
  }

  type Subscription {
    messageAdded(chatId: ID!): Message
  }

  type Story {
    id: ID!
    title: String!
    content: String
  }

  type User {
    id: ID!
    name: String!
    email: String!
  }

  type Post {
    id: ID!
    title: String!
    publishedAt: Date
  }

  type Message {
    id: ID!
    content: String!
    user: User!
  }

  input PageInput {
    id: ID!
    title: String!
    show: Boolean!
    width: Int!
    height: Float!
    pageType: PageType!
    date: Date
  }

  input AttributeInput {
    key: String
    val: String
  }
`);

const operationsDoc = /* GraphQL */ `
  query Editor_StoryQuery($storyId: ID!) {
    story(id: $storyId) {
      id
      title
    }
  }

  query GetUserProfileQuery($userId: ID!, $includePreferences: Boolean = false) {
    user(id: $userId) {
      id
      name
    }
  }

  mutation UpdateDefaultBrandKitMutation($input: PageInput!) {
    updateDefaultBrandKit(input: $input) {
      id
      title
    }
  }

  mutation CreateUserMutation($email: String!, $name: String!, $age: Int) {
    createUser(email: $email, name: $name, age: $age) {
      id
      email
      name
    }
  }

  subscription MessageAddedSubscription($chatId: ID!) {
    messageAdded(chatId: $chatId) {
      id
      content
    }
  }

  query ComplexVariablesQuery(
    $stringVar: String!
    $intVar: Int!
    $floatVar: Float!
    $boolVar: Boolean!
    $idVar: ID!
    $enumVar: PageType!
    $inputVar: AttributeInput!
    $optionalString: String
    $arrayVar: [String!]!
    $optionalArray: [Int]
    $dateVar: Date
  ) {
    story(id: $idVar) {
      id
      title
    }
  }
`;

const documents = [
  {
    location: 'test.graphql',
    document: parse(operationsDoc)
  }
];

describe('Operation Variable Schema Generation', () => {
  describe('Zod Schema Generation', () => {
    it('should generate operation variable schemas for zod', async () => {
      const config: ValidationSchemaPluginConfig = {
        schema: 'zod',
        withOperationVariables: true,
        importFrom: './types',
        scalars: {
          ID: 'string',
          Date: 'string'
        }
      };

      const result = await plugin(schema, documents as any, config);

      // Check that all operation schemas are generated
      expect(result.content).toContain('Editor_StoryQueryVariableSchema');
      expect(result.content).toContain('GetUserProfileQueryVariableSchema');
      expect(result.content).toContain('UpdateDefaultBrandKitMutationVariableSchema');
      expect(result.content).toContain('CreateUserMutationVariableSchema');
      expect(result.content).toContain('MessageAddedSubscriptionVariableSchema');
      expect(result.content).toContain('ComplexVariablesQueryVariableSchema');

      // Check that required fields are handled correctly
      expect(result.content).toContain('storyId: z.string()');
      expect(result.content).toContain('userId: z.string()');
      expect(result.content).toContain('email: z.string()');
      expect(result.content).toContain('name: z.string()');

      // Check that optional fields with defaults are handled correctly
      expect(result.content).toContain('includePreferences: z.boolean().default(false).optional()');

      // Check that optional fields are handled correctly
      expect(result.content).toContain('age: z.number().optional()');
      expect(result.content).toContain('optionalString: z.string().optional()');
      expect(result.content).toContain('optionalArray: z.array(z.number().optional()).optional()');

      // Check that input types are referenced correctly
      expect(result.content).toContain('input: PageInputSchema()');
      expect(result.content).toContain('inputVar: AttributeInputSchema()');

      // Check that arrays are handled correctly
      expect(result.content).toContain('arrayVar: z.array(z.string())');

      // Check that enums are handled correctly
      expect(result.content).toContain('enumVar: PageTypeSchema');

      // Check that proper TypeScript types are referenced
      expect(result.content).toContain('Editor_StoryQueryQueryVariables');
      expect(result.content).toContain('UpdateDefaultBrandKitMutationMutationVariables');
      expect(result.content).toContain('ComplexVariablesQueryQueryVariables');
    });

    it('should generate zod schemas with const export type', async () => {
      const config: ValidationSchemaPluginConfig = {
        schema: 'zod',
        withOperationVariables: true,
        validationSchemaExportType: 'const',
        importFrom: './types'
      };

      const result = await plugin(schema, documents as any, config);

      expect(result.content).toContain(
        'export const Editor_StoryQueryVariableSchema: z.ZodObject<Properties<Editor_StoryQueryQueryVariables>>'
      );
      expect(result.content).toContain('= z.object({');
      expect(result.content).not.toContain('export function Editor_StoryQueryVariableSchema()');
    });

    it('should support custom suffix for operation variable schemas', async () => {
      const config: ValidationSchemaPluginConfig = {
        schema: 'zod',
        withOperationVariables: true,
        operationVariablesSchemaSuffix: 'VarsSchema',
        importFrom: './types'
      };

      const result = await plugin(schema, documents as any, config);

      expect(result.content).toContain('Editor_StoryQueryVarsSchema');
      expect(result.content).toContain('GetUserProfileQueryVarsSchema');
      expect(result.content).toContain('UpdateDefaultBrandKitMutationVarsSchema');
      expect(result.content).not.toContain('VariableSchema');
    });
  });

  describe('Yup Schema Generation', () => {
    it('should generate operation variable schemas for yup', async () => {
      const config: ValidationSchemaPluginConfig = {
        schema: 'yup',
        withOperationVariables: true,
        importFrom: './types',
        scalars: {
          ID: 'string',
          Date: 'string'
        }
      };

      const result = await plugin(schema, documents as any, config);

      expect(result.content).toContain('Editor_StoryQueryVariableSchema');
      expect(result.content).toContain('yup.SchemaOf<Editor_StoryQueryQueryVariables>');

      // Check that required fields are handled correctly
      expect(result.content).toContain('storyId: yup.string().defined()');
      expect(result.content).toContain('userId: yup.string().defined()');
      expect(result.content).toContain('email: yup.string().defined()');

      // Check that optional fields with defaults are handled correctly
      expect(result.content).toContain(
        'includePreferences: yup.boolean().default(false).optional()'
      );

      // Check that optional fields are handled correctly
      expect(result.content).toContain('age: yup.number().optional()');
      expect(result.content).toContain('optionalString: yup.string().optional()');

      // Check that input types are referenced correctly
      expect(result.content).toContain('input: PageInputSchema().defined()');

      // Check that arrays are handled correctly
      expect(result.content).toContain('arrayVar: yup.array(yup.string().defined()).defined()');
    });
  });

  describe('MyZod Schema Generation', () => {
    it('should generate operation variable schemas for myzod', async () => {
      const config: ValidationSchemaPluginConfig = {
        schema: 'myzod',
        withOperationVariables: true,
        importFrom: './types',
        scalars: {
          ID: 'string',
          Date: 'string'
        }
      };

      const result = await plugin(schema, documents as any, config);

      expect(result.content).toContain('Editor_StoryQueryVariableSchema');
      expect(result.content).toContain('mz.Type<Editor_StoryQueryQueryVariables>');

      // Check that required fields are handled correctly
      expect(result.content).toContain('storyId: mz.string()');
      expect(result.content).toContain('userId: mz.string()');

      // Check that optional fields with defaults are handled correctly
      expect(result.content).toContain(
        'includePreferences: mz.boolean().default(false).optional()'
      );

      // Check that optional fields are handled correctly
      expect(result.content).toContain('age: mz.number().optional()');

      // Check that input types are referenced correctly
      expect(result.content).toContain('input: PageInputSchema()');
    });
  });

  describe('Valibot Schema Generation', () => {
    it('should generate operation variable schemas for valibot', async () => {
      const config: ValidationSchemaPluginConfig = {
        schema: 'valibot',
        withOperationVariables: true,
        importFrom: './types',
        scalars: {
          ID: 'string',
          Date: 'string'
        }
      };

      const result = await plugin(schema, documents as any, config);

      expect(result.content).toContain('Editor_StoryQueryVariableSchema');
      expect(result.content).toContain(
        'v.ObjectSchema<Editor_StoryQueryQueryVariables, undefined>'
      );

      // Check that required fields are handled correctly
      expect(result.content).toContain('storyId: v.string()');
      expect(result.content).toContain('userId: v.string()');

      // Check that optional fields with defaults are handled correctly
      expect(result.content).toContain('includePreferences: v.optional(v.boolean(), false)');

      // Check that optional fields are handled correctly
      expect(result.content).toContain('age: v.optional(v.number())');

      // Check that input types are referenced correctly
      expect(result.content).toContain('input: PageInputSchema()');
    });
  });

  describe('Type Import Handling', () => {
    it('should import operation variable types when using named imports', async () => {
      const config: ValidationSchemaPluginConfig = {
        schema: 'zod',
        withOperationVariables: true,
        importFrom: './types',
        useTypeImports: true
      };

      const result = await plugin(schema, documents as any, config);

      const imports = result.prepend.join('\n');
      expect(imports).toContain('import type {');
      expect(imports).toContain('Editor_StoryQueryQueryVariables');
      expect(imports).toContain('GetUserProfileQueryQueryVariables');
      expect(imports).toContain('UpdateDefaultBrandKitMutationMutationVariables');
      expect(imports).toContain("} from './types'");
    });

    it('should handle namespaced imports correctly', async () => {
      const config: ValidationSchemaPluginConfig = {
        schema: 'zod',
        withOperationVariables: true,
        importFrom: './types',
        schemaNamespacedImportName: 'Types'
      };

      const result = await plugin(schema, documents as any, config);

      expect(result.content).toContain('Types.Editor_StoryQueryQueryVariables');
      expect(result.content).toContain('Types.UpdateDefaultBrandKitMutationMutationVariables');

      // Should not have separate import for operation variable types when using namespaced imports
      const imports = result.prepend.join('\n');
      expect(imports).not.toContain('Editor_StoryQueryQueryVariables');
    });

    it('should handle regular imports when useTypeImports is false', async () => {
      const config: ValidationSchemaPluginConfig = {
        schema: 'zod',
        withOperationVariables: true,
        importFrom: './types',
        useTypeImports: false
      };

      const result = await plugin(schema, documents as any, config);

      const imports = result.prepend.join('\n');
      expect(imports).toContain('import {');
      expect(imports).toContain('Editor_StoryQueryQueryVariables');
      expect(imports).not.toContain('import type {');
    });
  });

  describe('Configuration Options', () => {
    it('should not generate operation variable schemas when disabled', async () => {
      const config: ValidationSchemaPluginConfig = {
        schema: 'zod',
        withOperationVariables: false,
        importFrom: './types'
      };

      const result = await plugin(schema, documents as any, config);

      expect(result.content).not.toContain('Editor_StoryQueryVariableSchema');
      expect(result.content).not.toContain('GetUserProfileQueryVariableSchema');
      expect(result.content).not.toContain('VariableSchema');
    });

    it('should handle operations without variable definitions gracefully', async () => {
      const emptyOperationsDoc = /* GraphQL */ `
        query SimpleQuery {
          story(id: "fixed-id") {
            id
            title
          }
        }
      `;

      const emptyDocuments = [
        {
          location: 'test.graphql',
          document: parse(emptyOperationsDoc)
        }
      ];

      const config: ValidationSchemaPluginConfig = {
        schema: 'zod',
        withOperationVariables: true,
        importFrom: './types'
      };

      const result = await plugin(schema, emptyDocuments as any, config);

      // Should not generate any variable schemas
      expect(result.content).not.toContain('SimpleQueryVariableSchema');
      expect(result.content).not.toContain('VariableSchema');
    });

    it('should handle unnamed operations gracefully', async () => {
      const unnamedOperationsDoc = /* GraphQL */ `
        query ($id: ID!) {
          story(id: $id) {
            id
            title
          }
        }
      `;

      const unnamedDocuments = [
        {
          location: 'test.graphql',
          document: parse(unnamedOperationsDoc)
        }
      ];

      const config: ValidationSchemaPluginConfig = {
        schema: 'zod',
        withOperationVariables: true,
        importFrom: './types'
      };

      const result = await plugin(schema, unnamedDocuments as any, config);

      // Should not generate schemas for unnamed operations
      expect(result.content).not.toContain('VariableSchema');
    });
  });

  describe('Scalar and Custom Type Handling', () => {
    it('should handle custom scalar schemas', async () => {
      const customScalarDoc = /* GraphQL */ `
        query CustomScalarQuery($date: Date, $url: URL) {
          story(id: "test") {
            id
          }
        }
      `;

      const customDocuments = [
        {
          location: 'test.graphql',
          document: parse(customScalarDoc)
        }
      ];

      const config: ValidationSchemaPluginConfig = {
        schema: 'zod',
        withOperationVariables: true,
        importFrom: './types',
        scalarSchemas: {
          Date: 'z.date()',
          URL: 'z.string().url()'
        }
      };

      const result = await plugin(schema, customDocuments as any, config);

      expect(result.content).toContain('date: z.date().optional()');
      expect(result.content).toContain('url: z.string().url().optional()');
    });

    it('should use default scalar schema for unknown scalars', async () => {
      const config: ValidationSchemaPluginConfig = {
        schema: 'zod',
        withOperationVariables: true,
        importFrom: './types',
        defaultScalarTypeSchema: 'z.unknown()'
      };

      const result = await plugin(schema, documents as any, config);

      // Date scalar should use default
      expect(result.content).toContain('dateVar: z.unknown().optional()');
    });
  });

  describe('Array and Complex Type Handling', () => {
    it('should handle array types correctly', async () => {
      const config: ValidationSchemaPluginConfig = {
        schema: 'zod',
        withOperationVariables: true,
        importFrom: './types'
      };

      const result = await plugin(schema, documents as any, config);

      // Required array of required strings
      expect(result.content).toContain('arrayVar: z.array(z.string())');

      // Optional array of optional numbers
      expect(result.content).toContain('optionalArray: z.array(z.number().optional()).optional()');
    });

    it('should handle enum types correctly', async () => {
      const config: ValidationSchemaPluginConfig = {
        schema: 'zod',
        withOperationVariables: true,
        importFrom: './types'
      };

      const result = await plugin(schema, documents as any, config);

      expect(result.content).toContain('enumVar: PageTypeSchema');
    });

    it('should handle input object types correctly', async () => {
      const config: ValidationSchemaPluginConfig = {
        schema: 'zod',
        withOperationVariables: true,
        importFrom: './types'
      };

      const result = await plugin(schema, documents as any, config);

      expect(result.content).toContain('input: PageInputSchema()');
      expect(result.content).toContain('inputVar: AttributeInputSchema()');
    });
  });
});
