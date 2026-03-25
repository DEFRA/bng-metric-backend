const dbInfo = {
  method: 'GET',
  path: '/db-info',
  handler: async (request, _h) => {
    const result = await request.pg.query('SELECT version()')
    return { version: result.rows[0].version }
  }
}

export { dbInfo }
