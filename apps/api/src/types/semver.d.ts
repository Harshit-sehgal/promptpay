declare module 'semver' {
  const semver: {
    valid(version: string): string | null;
    gte(version: string, minimum: string): boolean;
  };

  export default semver;
}
