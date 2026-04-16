// Modified version of handwriting.js with fixed coordinate mapping
(function (window, document) {
    'use strict';

    var handwriting = window.handwriting || {};

    handwriting.Canvas = function (element) {
        this.element = element;
        this.ctx = element.getContext('2d');
        this.trace = [];
        this.steps = [];
        this.undoSteps = [];
        this.undo = false;
        this.redo = false;
        this.lineWidth = 3;
        this.options = {};

        var self = this;
        var isDrawing = false;
        var lastX = 0;
        var lastY = 0;

        // Get canvas position relative to viewport
        function getCanvasPosition(e) {
            const rect = self.element.getBoundingClientRect();
            const scaleX = self.element.width / rect.width;
            const scaleY = self.element.height / rect.height;
            
            let clientX, clientY;
            if (e.type.includes('touch')) {
                clientX = e.touches[0].clientX;
                clientY = e.touches[0].clientY;
            } else {
                clientX = e.clientX;
                clientY = e.clientY;
            }

            return {
                x: (clientX - rect.left) * scaleX,
                y: (clientY - rect.top) * scaleY
            };
        }

        function startDrawing(e) {
            isDrawing = true;
            const pos = getCanvasPosition(e);
            lastX = pos.x;
            lastY = pos.y;
            self.trace.push([[], []]);
            self.steps.push([lastX, lastY]);
        }

        function draw(e) {
            if (!isDrawing) return;
            const pos = getCanvasPosition(e);
            const x = pos.x;
            const y = pos.y;

            self.ctx.beginPath();
            self.ctx.moveTo(lastX, lastY);
            self.ctx.lineTo(x, y);
            self.ctx.stroke();

            self.trace[self.trace.length - 1][0].push(x);
            self.trace[self.trace.length - 1][1].push(y);
            self.steps.push([x, y]);

            lastX = x;
            lastY = y;
        }

        function stopDrawing() {
            isDrawing = false;
        }

        // Mouse events
        element.addEventListener('mousedown', startDrawing);
        element.addEventListener('mousemove', draw);
        element.addEventListener('mouseup', stopDrawing);
        element.addEventListener('mouseout', stopDrawing);

        // Touch events
        element.addEventListener('touchstart', function (e) {
            e.preventDefault();
            startDrawing(e);
        });
        element.addEventListener('touchmove', function (e) {
            e.preventDefault();
            draw(e);
        });
        element.addEventListener('touchend', stopDrawing);
    };

    handwriting.Canvas.prototype = {
        setOptions: function (options) {
            this.options = options;
        },
        setCallBack: function (callback) {
            this.callback = callback;
        },
        setLineWidth: function (width) {
            this.lineWidth = width;
            this.ctx.lineWidth = width;
        },
        recognize: function () {
            if (this.trace.length === 0) return;
            handwriting.recognize(this.trace, this.options, this.callback);
        },
        erase: function () {
            this.ctx.clearRect(0, 0, this.element.width, this.element.height);
            this.trace = [];
            this.steps = [];
            this.undoSteps = [];
        },
        set_Undo_Redo: function (undo, redo) {
            this.undo = undo;
            this.redo = redo && undo;
            if (!undo) {
                this.steps = [];
                this.undoSteps = [];
            }
        },
        undo: function () {
            if (!this.undo || this.steps.length === 0) return;
            this.undoSteps.push(this.steps.pop());
            this.redraw();
        },
        redo: function () {
            if (!this.redo || this.undoSteps.length === 0) return;
            this.steps.push(this.undoSteps.pop());
            this.redraw();
        },
        redraw: function () {
            this.ctx.clearRect(0, 0, this.element.width, this.element.height);
            this.trace = [];
            var stroke = [[], []];
            for (var i = 0; i < this.steps.length; i++) {
                stroke[0].push(this.steps[i][0]);
                stroke[1].push(this.steps[i][1]);
                if (i === this.steps.length - 1 || (this.steps[i + 1][0] === 0 && this.steps[i + 1][1] === 0)) {
                    this.trace.push(stroke);
                    stroke = [[], []];
                }
            }
            for (var j = 0; j < this.trace.length; j++) {
                this.ctx.beginPath();
                this.ctx.moveTo(this.trace[j][0][0], this.trace[j][1][0]);
                for (var k = 1; k < this.trace[j][0].length; k++) {
                    this.ctx.lineTo(this.trace[j][0][k], this.trace[j][1][k]);
                }
                this.ctx.stroke();
            }
        }
    };

    window.handwriting = handwriting;
})(window, document); 