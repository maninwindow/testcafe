import { find, sortBy } from 'lodash';
import ReporterPluginHost from './plugin-host';

export default class Reporter {
    constructor (plugin, task, outStream) {
        this.plugin = new ReporterPluginHost(plugin, outStream);

        this.passed      = 0;
        this.testCount   = task.tests.length;
        this.reportQueue = Reporter._createReportQueue(task);

        this._assignTaskEventHandlers(task);
    }

    // Static
    static _createReportQueue (task) {
        var runsPerTest = task.browserConnections.length;

        return task.tests.map(test => Reporter._createReportItem(test, runsPerTest));
    }

    static _createReportItem (test, runsPerTest) {
        return {
            fixture:        test.fixture,
            test:           test,
            screenshotPath: null,
            pendingRuns:    runsPerTest,
            errs:           [],
            unstable:       false,
            startTime:      null
        };
    }

    static _createTestRunInfo (reportItem) {
        return {
            errs:           sortBy(reportItem.errs, ['userAgent', 'type']),
            durationMs:     new Date() - reportItem.startTime,
            unstable:       reportItem.unstable,
            screenshotPath: reportItem.screenshotPath
        };
    }

    _getReportItemForTestRun (testRun) {
        return find(this.reportQueue, i => i.test === testRun.test);
    }

    _shiftReportQueue () {
        // NOTE: a completed report item is always at the front of the queue.
        // This happens because the next test can't be completed until the
        // previous one frees all browser connections.
        // Therefore, tests always get completed sequentially.
        var reportItem = this.reportQueue.shift();

        if (!reportItem.errs.length)
            this.passed++;

        this.plugin.reportTestDone(reportItem.test.name, Reporter._createTestRunInfo(reportItem));

        // NOTE: here we assume that tests are sorted by fixture.
        // Therefore, if the next report item has a different
        // fixture, we can report this fixture start.
        var nextReportItem = this.reportQueue[0];

        if (nextReportItem && nextReportItem.fixture !== reportItem.fixture)
            this.plugin.reportFixtureStart(nextReportItem.fixture.name, nextReportItem.fixture.path);
    }

    _assignTaskEventHandlers (task) {
        task.once('start', () => {
            var startTime  = new Date();
            var userAgents = task.browserConnections.map(bc => bc.userAgent);
            var first      = this.reportQueue[0];

            this.plugin.reportTaskStart(startTime, userAgents, this.testCount);
            this.plugin.reportFixtureStart(first.fixture.name, first.fixture.path);
        });

        task.on('test-run-start', testRun => {
            var reportItem = this._getReportItemForTestRun(testRun);

            if (!reportItem.startTime)
                reportItem.startTime = new Date();
        });

        task.on('test-run-done', testRun => {
            var reportItem = this._getReportItemForTestRun(testRun);

            reportItem.pendingRuns--;
            reportItem.unstable = reportItem.unstable || testRun.unstable;
            reportItem.errs     = reportItem.errs.concat(testRun.errs);

            if (!reportItem.pendingRuns) {
                if (task.screenshots.hasCapturedFor(testRun.test))
                    reportItem.screenshotPath = task.screenshots.getPathFor(testRun.test);

                this._shiftReportQueue();
            }
        });

        task.once('done', () => {
            var endTime = new Date();

            this.plugin.reportTaskDone(endTime, this.passed, task.warningLog.messages);
        });
    }
}
