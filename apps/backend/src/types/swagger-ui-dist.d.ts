declare module 'swagger-ui-dist' {
  const swaggerUiDist: {
    getAbsoluteFSPath: () => string;
  };
  export default swaggerUiDist;
  export function getAbsoluteFSPath(): string;
}
