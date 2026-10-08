/**
 * Two names are the same with other spaces at the ends and in another case: a stage name or a template name. The handler of task
 * templates and the template menu of the Tasks tab use this one rule. It lives here, so the screens need no handler code.
 */
export const sameText = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();
