function setUrlParameter(urlKey, urlValue)
{
	if ('URLSearchParams' in window) {
		var searchParams = new URLSearchParams(window.location.search)
		searchParams.set(urlKey, urlValue);
		var newRelativePathQuery = window.location.pathname + '?' + searchParams.toString();
		history.pushState(null, '', newRelativePathQuery);
	}
}
function deleteUrlParameter(urlKey)
{
	if ('URLSearchParams' in window) {
		var searchParams = new URLSearchParams(window.location.search)
		searchParams.delete(urlKey);
		var newRelativePathQuery = window.location.pathname + '?' + searchParams.toString();
		history.pushState(null, '', newRelativePathQuery);
	}
}
