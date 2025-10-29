/**
 * Wrap a synchronous factory so it always yields a {@link Promise}.
 *
 * @remarks
 *
 * Many concrete path methods expose asynchronous variants that delegate to synchronous implementations.
 * This helper standardises the pattern while preserving thrown errors as rejected promises.
 *
 * @param factory - Synchronous function producing a value.
 * @returns A promise that resolves with the factory result or rejects with the thrown error.
 */
export function toPromise<T>(factory: () => T): Promise<T> {
	try {
		return Promise.resolve(factory());
	} catch (error) {
		return Promise.reject(error);
	}
}
