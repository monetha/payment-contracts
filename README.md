# payment-contracts [![Build Status][1]][2]

[1]: https://travis-ci.org/monetha/payment-contracts.svg?branch=master
[2]: https://travis-ci.org/monetha/payment-contracts

## Building the source

### Prerequisites

1. Make sure you have [Git](https://git-scm.com/book/en/v2/Getting-Started-Installing-Git) installed.
1. Install [Node.js](https://nodejs.org/en/) or use node in docker by running the following command from the project directory:
   ```bash
   $ docker run -it --rm -v "$PWD":/project -w /project node:9.11.2 /bin/bash
   ```

### Build and test

Install dependencies:

    npm install

Compile contracts:

    npm run compile

Run the tests:

    npm run automate-test