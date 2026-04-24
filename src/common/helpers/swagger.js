import path from 'node:path'
import { fileURLToPath } from 'node:url'

import swaggerJsdoc from 'swagger-jsdoc'

const swaggerUiDistPath = path.dirname(
  fileURLToPath(import.meta.resolve('swagger-ui-dist/package.json'))
)

const spec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'BNG Metric Backend API',
      version: '1.0.0'
    }
  },
  apis: ['./src/routes/*.js']
})

export const swagger = {
  plugin: {
    name: 'swagger',
    register(server) {
      server.route({
        method: 'GET',
        path: '/swagger.json',
        handler: (_request, h) => h.response(spec)
      })

      server.route({
        method: 'GET',
        path: '/docs/{param*}',
        handler: {
          directory: {
            path: swaggerUiDistPath,
            index: ['index.html']
          }
        }
      })

      server.route({
        method: 'GET',
        path: '/docs',
        handler: (_request, h) => h.redirect('/docs/index.html')
      })

      // Override the default swagger-initializer.js to point at our spec
      server.route({
        method: 'GET',
        path: '/docs/swagger-initializer.js',
        handler: (_request, h) =>
          h
            .response(
              `window.onload = function() {
  window.ui = SwaggerUIBundle({
    url: "/swagger.json",
    dom_id: "#swagger-ui",
    presets: [
      SwaggerUIBundle.presets.apis,
      SwaggerUIStandalonePreset
    ],
    layout: "StandaloneLayout"
  });
};`
            )
            .type('application/javascript')
      })
    }
  }
}
