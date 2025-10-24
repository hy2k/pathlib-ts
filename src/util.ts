export function toPromise<T>(factory: () => T): Promise<T> {
	try {
		return Promise.resolve(factory());
	} catch (error) {
		return Promise.reject(error);
	}
}
