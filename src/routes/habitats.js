const habitats = {
    method: 'GET',
    path: '/habitats/{proj_id}',
    handler: async (request, _h) => {
      
      const result = await request.pg.query('SELECT json from habitats where project_id = $1', [request.params.proj_id])
      
      const featureCollection = {
          type: 'FeatureCollection',
          features: result.rows.map(({ json }) => json),
      };

      return featureCollection
    }
  }
  
  const habitat = {
    method: 'GET',
    path: '/habitat/{id}',
    handler: async (request, _h) => {
      
      const result = await request.pg.query('SELECT json from habitats where id = $1', [request.params.id])
      
      if (result.rowCount === 0) {
        return _h.response('Habitat not found').code(404);
      }
      return result.rows[0].json;
    }
  }

  export { habitats, habitat }