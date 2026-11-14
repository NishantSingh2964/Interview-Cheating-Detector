const assert = require("node:assert/strict");
const { test } = require("node:test");
const { inflateSync } = require("node:zlib");
const {
  detectFaceCount,
  detectObjects,
  verifyRekognitionAccess,
} = require("./rekognitionService");

test("detectFaceCount sends the frame to Rekognition and returns the face count", async () => {
  const frame = Buffer.from("jpeg-frame");
  let command;
  const fakeClient = {
    send: async (request) => {
      command = request;
      return { FaceDetails: [{}, {}] };
    },
  };

  const count = await detectFaceCount(frame, fakeClient);

  assert.equal(count, 2);
  assert.equal(command.input.Image.Bytes, frame);
  assert.deepEqual(command.input.Attributes, ["DEFAULT"]);
});

test("detectFaceCount rejects empty or non-buffer input", async () => {
  await assert.rejects(() => detectFaceCount(null, { send() {} }), {
    statusCode: 400,
  });
  await assert.rejects(() => detectFaceCount(Buffer.alloc(0), { send() {} }), {
    statusCode: 400,
  });
});

test("detectObjects returns only relevant labels with instance boxes", async () => {
  const fakeClient = {
    send: async () => ({
      Labels: [
        {
          Name: "Cell Phone",
          Confidence: 99,
          Instances: [{
            Confidence: 98,
            BoundingBox: { Left: 0.1, Top: 0.2, Width: 0.3, Height: 0.4 },
          }],
        },
        {
          Name: "Computer",
          Confidence: 99,
          Instances: [{
            Confidence: 98,
            BoundingBox: { Left: 0.5, Top: 0.2, Width: 0.3, Height: 0.4 },
          }],
        },
        { Name: "Tree", Confidence: 99, Instances: [] },
      ],
    }),
  };

  assert.deepEqual(await detectObjects(Buffer.from("jpeg-frame"), fakeClient), [
    {
      label: "cell phone",
      score: 0.98,
      x: 0.1,
      y: 0.2,
      width: 0.3,
      height: 0.4,
    },
  ]);
});

test("verifyRekognitionAccess checks both face and label permissions", async () => {
  const commands = [];
  await verifyRekognitionAccess({
    send: async (command) => {
      commands.push(command);
      return command.constructor.name === "DetectFacesCommand"
        ? { FaceDetails: [] }
        : { Labels: [] };
    },
  });

  assert.deepEqual(
    commands.map((command) => command.constructor.name).sort(),
    ["DetectFacesCommand", "DetectLabelsCommand"],
  );
  const image = commands[0].input.Image.Bytes;
  assert.deepEqual(image.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.equal(image.readUInt32BE(16), 100);
  assert.equal(image.readUInt32BE(20), 100);

  const idatChunks = [];
  let offset = 8;
  while (offset < image.length) {
    const length = image.readUInt32BE(offset);
    const type = image.toString("ascii", offset + 4, offset + 8);
    if (type === "IDAT") idatChunks.push(image.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  assert.equal(inflateSync(Buffer.concat(idatChunks)).length, 100 * (1 + 100 * 3));
});
