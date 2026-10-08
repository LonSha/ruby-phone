report({ name: 'innerWidth', ok: true, detail: 'innerWidth=' + window.innerWidth + ' innerHeight=' + window.innerHeight +
  ' outerWidth=' + window.outerWidth + ' docEl=' + document.documentElement.clientWidth +
  ' visualViewport=' + (window.visualViewport ? Math.round(window.visualViewport.width) : 'n/a') });
const st = document.getElementById('__stage');
report({ name: 'stage', ok: true, detail: st ? '#' + Math.round(st.getBoundingClientRect().width) + 'x' + Math.round(st.getBoundingClientRect().height) : 'none' });
report({ name: 'media', ok: true, detail: 'maxW340=' + window.matchMedia('(max-width: 340px)').matches + ' maxW400=' + window.matchMedia('(max-width: 400px)').matches + ' maxW500=' + window.matchMedia('(max-width: 500px)').matches });
done();